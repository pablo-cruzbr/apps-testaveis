# Do `controller + service` para uma API testável

> Guia de estudo, com antes e depois, usando como exemplo o **Mestre da Comanda** (o seu backend de sempre).
> Objetivo: entender **o que acontece por baixo dos panos** numa requisição, **onde cada validação deve morar** e **como testar tudo sem banco de dados**.

---

## Sumário

0. [Você já sabe mais do que imagina](#0-você-já-sabe-mais-do-que-imagina)
1. [Por baixo dos panos: a vida de uma requisição](#1-por-baixo-dos-panos-a-vida-de-uma-requisição)
2. [O fluxo do usuário: a comanda](#2-o-fluxo-do-usuário-a-comanda)
3. [O problema escondido no "antes"](#3-o-problema-escondido-no-antes)
4. [Os 3 tipos de validação (e onde cada um mora)](#4-os-3-tipos-de-validação-e-onde-cada-um-mora)
5. [Construindo o "depois", passo a passo](#5-construindo-o-depois-passo-a-passo)
6. [Testando: do unitário ao fluxo completo do usuário](#6-testando-do-unitário-ao-fluxo-completo-do-usuário)
7. [Erros com o status HTTP certo](#7-erros-com-o-status-http-certo)
8. [Estrutura de pastas: antes x depois](#8-estrutura-de-pastas-antes-x-depois)
9. [Como migrar sem reescrever tudo](#9-como-migrar-sem-reescrever-tudo)
10. [Exercícios para virar pleno](#10-exercícios-para-virar-pleno)

---

## 0. Você já sabe mais do que imagina

A arquitetura do guia **não joga fora** o que você sabe. Ela **reorganiza** as mesmas peças.

| O que você faz hoje | Para que serve | Como fica no "depois" |
|---|---|---|
| `routes.ts` | Liga URL → controller | **Continua igual** |
| `Middlewares/isAuthenticated.ts` | Barra quem não tem token | **Continua igual** |
| `XxxController` | Lê `req`, chama o service, devolve `res` | **Continua quase igual**, só fica mais "burro" |
| `XxxService` | Regra de negócio **+** acesso ao banco, tudo junto | Vira **caso de uso** (só regra e orquestração) |
| `prismaClient` importado no service | Fala com o banco | Vai para um **repositório** (`PrismaOrdersRepository`) |
| *(não existe)* | – | **Entidade**: o objeto `Order` que se protege sozinho |
| *(não existe)* | – | **Contrato do repositório**: uma `interface` |
| *(não existe)* | – | **Repositório em memória**: para os testes |

> 💡 **Ideia central:** hoje o seu *service* faz duas coisas: decide (regra) e executa (banco).
> No "depois", **separamos o decidir do executar**. O decidir fica testável. O executar vira um detalhe que dá para trocar.

---

## 1. Por baixo dos panos: a vida de uma requisição

Antes de mudar qualquer coisa, vale entender **exatamente** o que acontece no seu backend quando o app do garçom faz:

```http
POST /order/add
Authorization: Bearer eyJhbGciOi...
Content-Type: application/json

{ "order_id": "abc-123", "product_id": "prod-9", "amount": 2 }
```

### O caminho no seu `server.ts` atual

```
 App do garçom
      │  (texto HTTP pela rede)
      ▼
┌──────────────────────────────────────────────────────────────────┐
│ Node.js recebe bytes → Express monta os objetos req e res        │
│                                                                  │
│ 1. express.json()       transforma o corpo (texto) em req.body   │
│ 2. cors(...)            confere se a origem pode chamar a API    │
│ 3. fileUpload(...)      (só age se vier arquivo)                 │
│ 4. router               procura "POST /order/add"                │
│ 5. isAuthenticated      lê o header, valida o JWT,               │
│                         coloca req.user_id e chama next()        │
│ 6. AddItemController    tira dados de req.body                   │
│ 7. AddItemService       chama prismaClient.item.create(...)      │
│ 8. Prisma               gera SQL → PostgreSQL → resultado        │
│ 9. Controller           res.json(item) → resposta 200            │
│                                                                  │
│ ✖ Se algo der throw em 5–8:                                      │
│   express-async-errors captura e manda para o error handler      │
│   (aquele app.use((err, req, res, next) => ...) no fim)          │
└──────────────────────────────────────────────────────────────────┘
```

Detalhes que quase ninguém explica para júnior:

- **Middleware é só uma função na fila.** O Express chama uma depois da outra. `next()` passa a vez para a próxima; `res.status(401).end()` **corta a fila** e responde.
- **`req.body` é texto convertido.** O JSON não sabe o que é `number` no seu TypeScript. Se o app mandar `"amount": "2"` (string) ou `"amount": -5`, o TypeScript **não vai reclamar**, porque as tipagens só existem na hora de compilar. **Em tempo de execução, nada valida nada, a não ser que você valide.**
- **`express-async-errors`** é o que faz um `throw` dentro de função `async` chegar no seu error handler. Sem ele, o erro sumiria e a requisição ficaria pendurada.
- **O seu error handler devolve 400 para tudo.** `err instanceof Error` é verdadeiro para praticamente **qualquer** erro, inclusive bug seu e banco fora do ar. Voltamos a isso na [seção 7](#7-erros-com-o-status-http-certo).

### O mesmo caminho no "depois"

```
 req ─▶ express.json ─▶ cors ─▶ router ─▶ isAuthenticated ─▶ Controller
                                                                │
              (validação de FORMATO: é número? veio o campo?)  │
                                                                ▼
                                                       Caso de uso (AddItem)
                                                                │
                      (validação de CONTEXTO: a comanda existe?  │
                       o produto existe?)                       │
                                                                ▼
                                                       Entidade (Order)
                                                                │
                     (validação de REGRA FIXA: quantidade > 0,  │
                      comanda ainda é rascunho?)                │
                                                                ▼
                                          Repositório (interface)
                                         ┌──────────┴──────────┐
                                    Prisma (produção)    Memória (testes)
```

Repare: **as setas de dependência apontam para dentro**. A entidade não sabe que existe Express. O caso de uso não sabe que existe Prisma. É isso que deixa testar sem subir nada.

---

## 2. O fluxo do usuário: a comanda

Vamos olhar para o sistema **como o usuário usa**, e não como as pastas estão organizadas. Essa é uma virada de chave importante para o nível pleno.

```
  Garçom                         Sistema                             Cozinha
    │                               │                                   │
    │ 1. Abre comanda (mesa 5)      │                                   │
    ├──────────────────────────────▶│  Order { draft: true }            │
    │                               │                                   │
    │ 2. Adiciona 2x Pizza          │                                   │
    ├──────────────────────────────▶│  Item ligado à Order              │
    │                               │                                   │
    │ 3. Envia para a cozinha       │                                   │
    ├──────────────────────────────▶│  Order { draft: false } ─────────▶│ aparece na lista
    │                               │                                   │
    │                               │   4. Finaliza o pedido            │
    │                               │◀──────────────────────────────────┤
    │                               │  Order { status: true }           │
```

Agora a pergunta que **sêniores fazem e júniores pulam**: *o que NÃO pode acontecer nesse fluxo?*

| # | Regra de negócio | O seu código atual garante? |
|---|---|---|
| R1 | Mesa precisa ser um número inteiro positivo | ❌ aceita `-3`, `0`, `2.5` |
| R2 | Quantidade de um item precisa ser inteira e maior que zero | ❌ aceita `amount: 0` ou `-10` |
| R3 | Não dá para adicionar item numa comanda que **não existe** | ⚠️ só falha por causa da *foreign key* do banco, com erro feio do Prisma |
| R4 | Não dá para adicionar item numa comanda **já enviada** para a cozinha | ❌ |
| R5 | Não dá para enviar comanda **vazia** | ❌ |
| R6 | Não dá para enviar uma comanda **duas vezes** | ❌ |
| R7 | Só dá para finalizar comanda que **já foi enviada** | ❌ (dá para finalizar um rascunho) |

> 🎯 **Isso é o que separa júnior de pleno:** o júnior faz o caminho feliz funcionar. O pleno **lista o que pode dar errado** e garante, com teste, que o sistema não deixa acontecer.

Essa tabela vai virar **a sua lista de testes**.

---

## 3. O problema escondido no "antes"

Este é o seu `AddItemService` hoje:

```ts
// ANTES: services/order/AddItemService.ts
import prismaClient from "../../prisma";

interface ItemRequest {
    order_id: string;
    product_id: string;
    amount: number
}

class AddItemService {
    async execute({ order_id, product_id, amount }: ItemRequest) {
        const product = prismaClient.item.create({
            data: { order_id, product_id, amount },
        })
        return product;
    }
}
```

Ele funciona, mas tem **três problemas estruturais**. Não é que esteja "errado": é que o formato do código **impede** de fazer melhor.

### Problema 1: impossível testar sem banco

```ts
import prismaClient from "../../prisma";   // ← o service ESCOLHE sozinho o banco
```

Para testar o `AddItemService` você precisaria de um Postgres rodando, com uma `Order` e um `Product` já criados, e depois limpar tudo. Resultado na prática: **ninguém testa**.

> Essa linha de `import` é uma **dependência concreta**. O service depende do Prisma, e não de uma *ideia* de "lugar onde se guardam comandas". É exatamente o **D do SOLID** (Inversão de Dependência) sendo violado.

### Problema 2: as regras não têm onde morar

Onde você colocaria a regra R4 ("não adicionar em comanda já enviada")? No service, misturada com Prisma:

```ts
const order = await prismaClient.order.findFirst({ where: { id: order_id } })
if (!order) throw new Error("Comanda não existe")
if (!order.draft) throw new Error("Comanda já enviada")
if (amount <= 0) throw new Error("Quantidade inválida")
// ... e a regra R2 se repete no RemoveItemService, no UpdateItemService...
```

Isso funciona, mas a regra "o que é uma comanda válida" fica **espalhada por vários services** e **amarrada ao banco**.

### Problema 3: todo erro vira 400

```ts
throw new Error("Comanda já enviada")   // devia ser 409/422
throw new Error("Comanda não existe")   // devia ser 404
// e se o banco cair? também vira 400, com a mensagem interna do Prisma vazando pro cliente
```

### Bônus: uma pegadinha no seu código

```ts
const product = prismaClient.item.create({ ... })   // sem await
return product;
```

Funciona porque a função é `async` e devolve a Promise. Mas se um dia você colocar um `try/catch` em volta, **ele não vai pegar o erro**, porque o erro acontece depois que a função já retornou. Regra prática: **sempre dê `await` em chamada ao banco**.

---

## 4. Os 3 tipos de validação (e onde cada um mora)

Essa é provavelmente **a lição mais importante deste guia**. Toda validação cai em uma de três caixas:

| Tipo | Pergunta | Precisa de outros dados? | Onde mora | Exemplo na comanda |
|---|---|---|---|---|
| **1. Formato** | "O que chegou tem o formato certo?" | Não | **Controller** (borda HTTP) | `amount` é número? `order_id` veio? |
| **2. Regra fixa** | "Isso faz sentido, sempre?" | Não, só o próprio objeto | **Entidade** | quantidade > 0; não altera comanda enviada |
| **3. Regra de contexto** | "Isso faz sentido *agora*, dado o que existe?" | **Sim**, consulta o repositório | **Caso de uso** | a comanda existe? o produto existe? |

Um jeito fácil de decidir:

```
A validação precisa olhar o banco?
 ├─ SIM → caso de uso
 └─ NÃO → é sobre o FORMATO do JSON (tipo, campo faltando)?
          ├─ SIM → controller
          └─ NÃO → entidade (é uma regra do negócio que vale sempre)
```

> **Por que não validar tudo no controller?** Porque amanhã a mesma ação pode vir de outro lugar: um job agendado, uma fila, um script de importação, um teste. Se a regra estiver no controller, **esses caminhos passam por fora dela**. Regra na entidade vale **para qualquer porta de entrada**.

---

## 5. Construindo o "depois", passo a passo

Vamos reconstruir o fluxo da comanda **de dentro para fora**: entidade → contrato → caso de uso → teste → só no final, Prisma e Express.

### Passo 5.1: Erros de domínio

Antes de tudo, criamos erros **com significado**. Isso vai permitir o status HTTP certo depois.

```ts
// src/core/errors.ts
export class DomainError extends Error {}          // regra de negócio violada
export class NotFoundError extends DomainError {}  // algo que devia existir não existe
```

### Passo 5.2: A entidade `Order`

A entidade é **o que o sistema É**. Ela guarda os dados **e protege as próprias regras** (R1, R2, R4, R5, R6, R7).

```ts
// src/entities/order.ts
import { randomUUID } from 'node:crypto'
import { DomainError } from '../core/errors'

export interface OrderItem {
    id: string
    productId: string
    amount: number
}

export interface OrderProps {
    id?: string
    table: number
    name?: string | null
    draft?: boolean
    finished?: boolean
    items?: OrderItem[]
}

export class Order {
    private props: Required<OrderProps>

    constructor (props: OrderProps) {
        // R1: mesa inteira e positiva
        if (!Number.isInteger(props.table) || props.table <= 0) {
            throw new DomainError('A mesa deve ser um número inteiro maior que zero')
        }

        this.props = {
            id: props.id ?? randomUUID(),
            table: props.table,
            name: props.name ?? null,
            draft: props.draft ?? true,
            finished: props.finished ?? false,
            items: props.items ?? []
        }
    }

    get id () { return this.props.id }
    get table () { return this.props.table }
    get name () { return this.props.name }
    get draft () { return this.props.draft }
    get finished () { return this.props.finished }
    get items () { return [...this.props.items] }   // cópia: ninguém mexe na lista por fora

    addItem (productId: string, amount: number): OrderItem {
        // R4: só mexe em rascunho
        if (!this.props.draft) {
            throw new DomainError('Não é possível adicionar itens a uma comanda já enviada')
        }
        // R2: quantidade inteira e positiva
        if (!Number.isInteger(amount) || amount <= 0) {
            throw new DomainError('A quantidade deve ser um número inteiro maior que zero')
        }

        const item = { id: randomUUID(), productId, amount }
        this.props.items.push(item)
        return item
    }

    send () {
        // R6
        if (!this.props.draft) {
            throw new DomainError('Esta comanda já foi enviada')
        }
        // R5
        if (this.props.items.length === 0) {
            throw new DomainError('Não é possível enviar uma comanda vazia')
        }
        this.props.draft = false
    }

    finish () {
        // R7
        if (this.props.draft) {
            throw new DomainError('A comanda precisa ser enviada antes de ser finalizada')
        }
        this.props.finished = true
    }
}
```

**Antes x depois, em uma frase:**

- **Antes:** `draft: false` era só um campo que **qualquer service** podia mudar com um `prismaClient.order.update`.
- **Depois:** o único jeito de enviar uma comanda é chamar `order.send()`, e **ela mesma se recusa** se a ação não fizer sentido. Isso se chama **encapsulamento**: o objeto protege o próprio estado.

> Repare que **não tem nenhum `import` de Prisma ou Express** aqui. Esse arquivo roda em qualquer lugar.

### Passo 5.3: O contrato do repositório

O caso de uso precisa **buscar e salvar** comandas. Mas, em vez de importar o Prisma, ele diz **do que precisa** por meio de uma `interface`:

```ts
// src/repositories/orders-repository.ts
import { Order, OrderItem } from '../entities/order'

export interface OrdersRepository {
    create (order: Order): Promise<void>
    findById (id: string): Promise<Order | null>
    save (order: Order): Promise<void>                        // atualiza draft/finished
    addItem (orderId: string, item: OrderItem): Promise<void>
}
```

```ts
// src/repositories/products-repository.ts
export interface ProductsRepository {
    exists (id: string): Promise<boolean>
}
```

> Isso é o **I do SOLID** (Segregação de Interface): o `ProductsRepository` aqui só tem `exists`, porque é **só isso** que o caso de uso usa. Nada de interface "faz-tudo".

### Passo 5.4: Os casos de uso

O caso de uso é **o que o sistema FAZ**. Ele orquestra: busca, chama a entidade e salva.

```ts
// src/use-cases/add-item.ts
import { NotFoundError } from '../core/errors'
import { OrdersRepository } from '../repositories/orders-repository'
import { ProductsRepository } from '../repositories/products-repository'

interface AddItemRequest {
    orderId: string
    productId: string
    amount: number
}

export class AddItem {
    constructor (
        private ordersRepository: OrdersRepository,       // ← recebe de FORA
        private productsRepository: ProductsRepository    // ← recebe de FORA
    ) {}

    async execute ({ orderId, productId, amount }: AddItemRequest) {
        // R3 (regra de contexto: precisa consultar dados)
        const order = await this.ordersRepository.findById(orderId)
        if (!order) {
            throw new NotFoundError('Comanda não encontrada')
        }

        const productExists = await this.productsRepository.exists(productId)
        if (!productExists) {
            throw new NotFoundError('Produto não encontrado')
        }

        // R2 e R4 (regras fixas: a entidade cuida)
        const item = order.addItem(productId, amount)

        await this.ordersRepository.addItem(order.id, item)
        return item
    }
}
```

Compare com o "antes":

| | `AddItemService` (antes) | `AddItem` (depois) |
|---|---|---|
| Onde está o banco? | `import prismaClient` (fixo) | `constructor(ordersRepository)` (injetado) |
| Valida comanda existente? | Não | Sim, com erro 404 claro |
| Valida quantidade? | Não | Sim, na entidade |
| Valida comanda enviada? | Não | Sim, na entidade |
| Dá para testar sem Postgres? | Não | **Sim** |

Os outros casos de uso seguem o mesmo molde e ficam bem curtos, porque a entidade já faz o trabalho pesado:

```ts
// src/use-cases/create-order.ts
import { Order } from '../entities/order'
import { OrdersRepository } from '../repositories/orders-repository'

export class CreateOrder {
    constructor (private ordersRepository: OrdersRepository) {}

    async execute ({ table, name }: { table: number, name?: string }) {
        const order = new Order({ table, name })   // R1 validada aqui dentro
        await this.ordersRepository.create(order)
        return order
    }
}
```

```ts
// src/use-cases/send-order.ts
import { NotFoundError } from '../core/errors'
import { OrdersRepository } from '../repositories/orders-repository'

export class SendOrder {
    constructor (private ordersRepository: OrdersRepository) {}

    async execute ({ orderId }: { orderId: string }) {
        const order = await this.ordersRepository.findById(orderId)
        if (!order) throw new NotFoundError('Comanda não encontrada')

        order.send()                                  // R5 e R6
        await this.ordersRepository.save(order)
        return order
    }
}
```

> 🧪 **Exercício:** escreva o `FinishOrder` sozinho. É praticamente igual ao `SendOrder`, chamando `order.finish()`.

### Passo 5.5: O repositório em memória (o dublê de teste)

Uma implementação **de verdade** do contrato, só que guardando tudo num array:

```ts
// src/repositories/in-memory/in-memory-orders-repository.ts
import { Order, OrderItem } from '../../entities/order'
import { OrdersRepository } from '../orders-repository'

export class InMemoryOrdersRepository implements OrdersRepository {
    public items: Order[] = []   // public: o teste pode espiar o que foi salvo

    async create (order: Order) {
        this.items.push(order)
    }

    async findById (id: string) {
        return this.items.find(order => order.id === id) ?? null
    }

    async save (order: Order) {
        const index = this.items.findIndex(o => o.id === order.id)
        this.items[index] = order
    }

    async addItem (_orderId: string, _item: OrderItem) {
        // em memória, order.addItem() já colocou o item dentro do objeto
    }
}
```

```ts
// src/repositories/in-memory/in-memory-products-repository.ts
import { ProductsRepository } from '../products-repository'

export class InMemoryProductsRepository implements ProductsRepository {
    public ids: string[] = []

    async exists (id: string) {
        return this.ids.includes(id)
    }
}
```

### Passo 5.6: O repositório Prisma (produção)

**Mesmo contrato**, outra implementação. É aqui que o Prisma passa a morar, e **só aqui**:

```ts
// src/repositories/prisma/prisma-orders-repository.ts
import prismaClient from '../../prisma'
import { Order, OrderItem } from '../../entities/order'
import { OrdersRepository } from '../orders-repository'

export class PrismaOrdersRepository implements OrdersRepository {
    async create (order: Order) {
        await prismaClient.order.create({
            data: { id: order.id, table: order.table, name: order.name, draft: order.draft }
        })
    }

    async findById (id: string) {
        const row = await prismaClient.order.findUnique({
            where: { id },
            include: { items: true }
        })
        if (!row) return null

        // Tradução: linha do banco → entidade
        return new Order({
            id: row.id,
            table: row.table,
            name: row.name,
            draft: row.draft,
            finished: row.status,          // no banco o campo se chama "status"
            items: row.items.map(i => ({ id: i.id, productId: i.product_id, amount: i.amount }))
        })
    }

    async save (order: Order) {
        await prismaClient.order.update({
            where: { id: order.id },
            data: { draft: order.draft, status: order.finished }
        })
    }

    async addItem (orderId: string, item: OrderItem) {
        await prismaClient.item.create({
            data: { id: item.id, order_id: orderId, product_id: item.productId, amount: item.amount }
        })
    }
}
```

> Repare na tradução `finished: row.status`. No banco, o nome do campo é `status` (um nome que não diz muito). Na entidade, chamamos de `finished`. **O repositório é o tradutor entre o mundo do banco e o mundo do negócio.** Se um dia você renomear a coluna, só esse arquivo muda.

> Isso é o **L do SOLID** (Liskov): `InMemoryOrdersRepository` e `PrismaOrdersRepository` são **substituíveis**. O caso de uso não percebe a diferença.

### Passo 5.7: O controller (borda HTTP) com validação de formato

O controller continua no seu estilo de sempre. Só que agora ele faz **apenas** duas coisas: validar o **formato** e traduzir HTTP ↔ caso de uso.

Para validar formato, o padrão de mercado é o **Zod** (`npm i zod`):

```ts
// src/http/controllers/add-item-controller.ts
import { Request, Response } from 'express'
import { z } from 'zod'
import { makeAddItem } from '../factories/make-add-item'

const bodySchema = z.object({
    order_id: z.string().uuid(),
    product_id: z.string().uuid(),
    amount: z.coerce.number()      // "2" (string) vira 2; "abc" vira erro
})

export class AddItemController {
    async handle (req: Request, res: Response) {
        const { order_id, product_id, amount } = bodySchema.parse(req.body)  // validação de FORMATO

        const addItem = makeAddItem()
        const item = await addItem.execute({ orderId: order_id, productId: product_id, amount })

        return res.status(201).json(item)
    }
}
```

> Repare que o controller **não** verifica se `amount > 0`. Isso é regra de negócio e mora na entidade. O controller só garante que é *um número*. Cada camada faz **a sua parte**, sem repetir a das outras.

### Passo 5.8: A fábrica: onde as peças se encontram

Alguém precisa decidir "em produção, usa o Prisma". Esse alguém é uma **factory**, o único lugar que conhece as implementações concretas:

```ts
// src/http/factories/make-add-item.ts
import { AddItem } from '../../use-cases/add-item'
import { PrismaOrdersRepository } from '../../repositories/prisma/prisma-orders-repository'
import { PrismaProductsRepository } from '../../repositories/prisma/prisma-products-repository'

export function makeAddItem () {
    return new AddItem(new PrismaOrdersRepository(), new PrismaProductsRepository())
}
```

E as rotas **ficam iguais ao que você já faz**:

```ts
router.post('/order/add', isAuthenticated, new AddItemController().handle)
```

> Isso é a **injeção de dependência** na prática. NestJS, Spring e .NET fazem exatamente isso, só que com uma "mágica" automática. Fazendo na mão, você **entende o que a mágica faz**.

---

## 6. Testando: do unitário ao fluxo completo do usuário

### 6.1 Testando a entidade (regras fixas)

Sem banco, sem repositório, sem nada. Só a classe:

```ts
// src/entities/order.spec.ts
import { describe, expect, test } from 'vitest'
import { Order } from './order'
import { DomainError } from '../core/errors'

describe('Order', () => {
    test('cria uma comanda como rascunho', () => {
        const order = new Order({ table: 5 })

        expect(order.draft).toBe(true)
        expect(order.finished).toBe(false)
        expect(order.items).toHaveLength(0)
    })

    test.each([0, -3, 2.5])('não aceita mesa %s (R1)', (table) => {
        expect(() => new Order({ table })).toThrow(DomainError)
    })

    test.each([0, -1, 1.5])('não aceita quantidade %s (R2)', (amount) => {
        const order = new Order({ table: 5 })

        expect(() => order.addItem('prod-1', amount)).toThrow(DomainError)
    })

    test('não adiciona item em comanda enviada (R4)', () => {
        // Arrange
        const order = new Order({ table: 5 })
        order.addItem('prod-1', 1)
        order.send()

        // Act + Assert
        expect(() => order.addItem('prod-2', 1)).toThrow('já enviada')
    })

    test('não envia comanda vazia (R5)', () => {
        const order = new Order({ table: 5 })

        expect(() => order.send()).toThrow('vazia')
    })

    test('não envia a mesma comanda duas vezes (R6)', () => {
        const order = new Order({ table: 5 })
        order.addItem('prod-1', 1)
        order.send()

        expect(() => order.send()).toThrow('já foi enviada')
    })

    test('não finaliza rascunho (R7)', () => {
        const order = new Order({ table: 5 })

        expect(() => order.finish()).toThrow('enviada antes')
    })
})
```

> `test.each` roda o **mesmo teste com vários valores**. É ótimo para testar **limites** (`0`, negativo, decimal), que é onde os bugs costumam morar.

### 6.2 Testando um caso de uso (regras de contexto)

Aqui entram os repositórios em memória. Repare no `beforeEach`: **cada teste começa do zero**.

```ts
// src/use-cases/add-item.spec.ts
import { beforeEach, describe, expect, test } from 'vitest'
import { AddItem } from './add-item'
import { Order } from '../entities/order'
import { NotFoundError } from '../core/errors'
import { InMemoryOrdersRepository } from '../repositories/in-memory/in-memory-orders-repository'
import { InMemoryProductsRepository } from '../repositories/in-memory/in-memory-products-repository'

let ordersRepository: InMemoryOrdersRepository
let productsRepository: InMemoryProductsRepository
let sut: AddItem   // SUT = System Under Test (quem está sendo testado)

describe('AddItem', () => {
    beforeEach(() => {
        ordersRepository = new InMemoryOrdersRepository()
        productsRepository = new InMemoryProductsRepository()
        sut = new AddItem(ordersRepository, productsRepository)
    })

    test('adiciona item a uma comanda aberta', async () => {
        // Arrange
        const order = new Order({ table: 5 })
        await ordersRepository.create(order)
        productsRepository.ids.push('pizza')

        // Act
        const item = await sut.execute({ orderId: order.id, productId: 'pizza', amount: 2 })

        // Assert
        expect(item.amount).toBe(2)
        expect(ordersRepository.items[0].items).toHaveLength(1)
    })

    test('falha se a comanda não existe (R3)', async () => {
        productsRepository.ids.push('pizza')

        await expect(
            sut.execute({ orderId: 'nao-existe', productId: 'pizza', amount: 1 })
        ).rejects.toThrow(NotFoundError)
    })

    test('falha se o produto não existe', async () => {
        const order = new Order({ table: 5 })
        await ordersRepository.create(order)

        await expect(
            sut.execute({ orderId: order.id, productId: 'fantasma', amount: 1 })
        ).rejects.toThrow('Produto não encontrado')
    })
})
```

> ⚠️ **Pegadinha clássica:** com função `async`, use `await expect(...).rejects.toThrow()`. Se esquecer o `await`, o teste **passa mesmo quando deveria falhar**, porque ele termina antes da Promise rejeitar.

### 6.3 Testando o fluxo do usuário de ponta a ponta (ainda sem banco!)

Aqui está o pulo do gato: como tudo usa o **mesmo repositório em memória**, você consegue testar a **jornada inteira do garçom** em milissegundos:

```ts
// src/use-cases/order-flow.spec.ts
import { beforeEach, expect, test } from 'vitest'
import { CreateOrder } from './create-order'
import { AddItem } from './add-item'
import { SendOrder } from './send-order'
import { FinishOrder } from './finish-order'
import { InMemoryOrdersRepository } from '../repositories/in-memory/in-memory-orders-repository'
import { InMemoryProductsRepository } from '../repositories/in-memory/in-memory-products-repository'

let orders: InMemoryOrdersRepository
let products: InMemoryProductsRepository

beforeEach(() => {
    orders = new InMemoryOrdersRepository()
    products = new InMemoryProductsRepository()
    products.ids.push('pizza', 'refri')
})

test('garçom abre, preenche e envia; cozinha finaliza', async () => {
    const order = await new CreateOrder(orders).execute({ table: 5, name: 'Ana' })

    await new AddItem(orders, products).execute({ orderId: order.id, productId: 'pizza', amount: 2 })
    await new AddItem(orders, products).execute({ orderId: order.id, productId: 'refri', amount: 1 })

    await new SendOrder(orders).execute({ orderId: order.id })
    await new FinishOrder(orders).execute({ orderId: order.id })

    const saved = await orders.findById(order.id)
    expect(saved?.items).toHaveLength(2)
    expect(saved?.draft).toBe(false)
    expect(saved?.finished).toBe(true)
})

test('garçom tenta adicionar item depois de enviar', async () => {
    const order = await new CreateOrder(orders).execute({ table: 5 })
    await new AddItem(orders, products).execute({ orderId: order.id, productId: 'pizza', amount: 1 })
    await new SendOrder(orders).execute({ orderId: order.id })

    await expect(
        new AddItem(orders, products).execute({ orderId: order.id, productId: 'refri', amount: 1 })
    ).rejects.toThrow('já enviada')
})
```

> Esse teste **conta a história do usuário**. Se alguém quebrar a regra R4 daqui a seis meses, ele avisa na hora, antes de chegar em produção.

### 6.4 Checklist: o que testar em cada camada

| Camada | Tipo de teste | Precisa de quê? | O que verificar |
|---|---|---|---|
| Entidade | Unitário | Nada | Cada regra fixa: caminho feliz + cada limite |
| Caso de uso | Unitário | Repositório em memória | Regras de contexto (não existe, já existe...) |
| Fluxo do usuário | Unitário (vários casos de uso) | Repositório em memória | A jornada inteira e as tentativas "fora de ordem" |
| Repositório Prisma | Integração | Banco de teste (Docker) | Se a tradução banco ↔ entidade está certa |
| Rota HTTP | E2E | Servidor + banco (`supertest`) | Status code, autenticação, formato da resposta |

Lembre da pirâmide do [GUIA.md](GUIA.md): **muitos** testes nas três primeiras linhas, **poucos** nas duas últimas.

---

## 7. Erros com o status HTTP certo

### Antes

```ts
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof Error) {                       // ← quase sempre verdadeiro
        return res.status(400).json({ error: err.message })
    }
    return res.status(500).json({ status: 'error', message: 'Internal Server Error.' })
})
```

Problemas: um bug seu (`Cannot read properties of undefined`) volta como **400** e com a mensagem interna exposta. Comanda inexistente também é 400, quando devia ser **404**.

### Depois

Como agora os erros **têm tipo**, o handler decide o status olhando o tipo:

```ts
import { ZodError } from 'zod'
import { DomainError, NotFoundError } from './core/errors'

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof ZodError) {
        return res.status(400).json({ error: 'Dados inválidos', issues: err.issues })  // formato
    }
    if (err instanceof NotFoundError) {
        return res.status(404).json({ error: err.message })                           // não existe
    }
    if (err instanceof DomainError) {
        return res.status(422).json({ error: err.message })                           // regra violada
    }

    console.error(err)   // bug de verdade: loga para você e esconde do cliente
    return res.status(500).json({ error: 'Erro interno do servidor' })
})
```

> ⚠️ A ordem dos `if` importa: `NotFoundError` **é** um `DomainError` (porque herda dele), então tem que vir antes.

| Situação | Antes | Depois |
|---|---|---|
| `amount: "abc"` | 500 ou erro do Prisma | **400** Dados inválidos |
| Comanda não existe | 400 (mensagem do Prisma) | **404** Comanda não encontrada |
| Enviar comanda vazia | 200 (deixava!) | **422** Não é possível enviar uma comanda vazia |
| Bug no código | 400 + mensagem interna | **500** + log no servidor |

---

## 8. Estrutura de pastas: antes x depois

```
ANTES (Mestre da Comanda)              DEPOIS
src/                                   src/
├── controlers/                        ├── core/
│   └── order/                         │   └── errors.ts
│       ├── AddItemController.ts       ├── entities/               ← O que o sistema É
│       └── ...                        │   ├── order.ts
├── services/                          │   └── order.spec.ts
│   └── order/                         ├── repositories/           ← Contratos
│       ├── AddItemService.ts          │   ├── orders-repository.ts
│       └── ...                        │   ├── products-repository.ts
├── Middlewares/                       │   ├── in-memory/          ← Para testes
│   └── isAuthenticated.ts             │   └── prisma/             ← Para produção
├── prisma/                            ├── use-cases/              ← O que o sistema FAZ
│   └── index.ts                       │   ├── add-item.ts
├── routes.ts                          │   ├── add-item.spec.ts
└── server.ts                          │   ├── order-flow.spec.ts
                                       │   └── ...
                                       ├── http/                   ← Detalhe (Express)
                                       │   ├── controllers/
                                       │   ├── factories/
                                       │   ├── middlewares/
                                       │   └── routes.ts
                                       ├── prisma/
                                       │   └── index.ts
                                       └── server.ts
```

Repare: **tudo que é Express fica dentro de `http/`**. Se um dia você trocar para Fastify, só essa pasta muda. `entities/`, `use-cases/` e `repositories/` **nem ficam sabendo**.

---

## 9. Como migrar sem reescrever tudo

No trabalho, você **nunca** vai poder parar tudo para reescrever. O caminho profissional é **incremental**, um fluxo por vez:

1. **Escolha um fluxo que dói.** No Mestre da Comanda, o de comanda é o candidato óbvio: tem regra e tem estado.
2. **Escreva a lista de regras** (como a tabela da [seção 2](#2-o-fluxo-do-usuário-a-comanda)).
3. **Crie a entidade e os testes dela.** Ainda sem mexer em nada que já existe.
4. **Crie o contrato, o repositório em memória e o caso de uso**, com testes.
5. **Crie o repositório Prisma e a factory.**
6. **Troque o miolo do controller**: em vez de `new AddItemService()`, use `makeAddItem()`. A rota continua a mesma, então **o app nem percebe**.
7. Apague o service antigo. Faça um commit. Parta para o próximo fluxo.

> Isso tem nome: **Strangler Fig** (figueira estranguladora). O código novo vai crescendo em volta do antigo até substituí-lo, sem nunca deixar o sistema fora do ar. Citar isso numa entrevista pega bem.

---

## 10. Exercícios para virar pleno

Faça **neste repositório (apps-testaveis)**, sem copiar daqui, consultando só quando travar:

- [ ] **Agendamento (o tutorial):** adicione à entidade `Appointment` a regra "não pode terminar antes de começar" e escreva o teste que prova.
- [ ] **Caso de uso `CreateAppointment`** com `InMemoryAppointmentsRepository`, com a regra "não pode haver dois agendamentos sobrepostos". Pergunta: essa regra é de entidade ou de caso de uso? (Resposta na [seção 3 do GUIA.md](GUIA.md#3-entidade-x-caso-de-uso).)
- [ ] **`FinishOrder`**, partindo da [seção 5.4](#passo-54-os-casos-de-uso), com testes.
- [ ] **Usuário:** reescreva o `CreateUserService` do Mestre da Comanda. Dica: e-mail duplicado é regra de **caso de uso** (precisa consultar). Já o hash de senha é um **detalhe**: crie um contrato `HashProvider` com uma implementação `BcryptHashProvider` e uma `FakeHashProvider` para testes.
- [ ] **Um teste E2E** com `supertest` para `POST /order/add`, verificando que sem token a resposta é **401**.
- [ ] **CI:** um GitHub Actions que roda `npx vitest run` a cada push.

### Perguntas para se fazer sempre que for escrever código

1. Essa validação é de **formato**, **regra fixa** ou **contexto**? → Ela está na camada certa?
2. Esse arquivo **importa** Prisma/Express? → Ele deveria?
3. Consigo testar isso **sem subir banco**? → Se não, por quê?
4. Qual o **pior** valor que alguém pode mandar aqui? → Existe teste para ele?
5. Esse erro volta com o **status HTTP certo**?

> Quando essas cinco perguntas virarem automáticas, você vai estar pensando como pleno, independente do título no crachá.
