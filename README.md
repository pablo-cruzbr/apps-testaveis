# Arquitetura Limpa e SOLID: conceitos

> Anotações de estudo do **backend-architecture-lab**. Os exemplos usam o domínio de agendamento de horários.

---

## 1. Qual é a ideia?

Construir uma API em que **as regras de negócio vivem isoladas** e **não sabem que existe HTTP, banco de dados ou framework**.

Com isso:

- As regras são testadas com **testes unitários**: rápidos, sem servidor e sem banco.
- Trocar de framework (Express, Fastify...) ou de banco **não afeta** as regras.
- O código fica organizado e fácil de entender.

> **Frase-chave:** o framework é um *detalhe*. O coração da aplicação são as regras de negócio.

---

## 2. As camadas

Pense em círculos: o de dentro não conhece o de fora.

```
┌─────────────────────────────────────────────┐
│  Infra / Frameworks (HTTP, banco, libs)     │  ← detalhes trocáveis
│   ┌─────────────────────────────────────┐   │
│   │  Casos de uso                       │   │  ← o que o sistema FAZ
│   │   ┌─────────────────────────────┐   │   │
│   │   │  Entidades                  │   │   │  ← o que o sistema É
│   │   └─────────────────────────────┘   │   │
│   └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
        As dependências apontam sempre PARA DENTRO
```

| Camada | Responsabilidade | Pergunta que ela responde |
|---|---|---|
| **Entidades** | Dados e regras que valem sempre, em qualquer situação | "O que é um agendamento válido?" |
| **Casos de uso** | Orquestram uma ação específica do sistema | "O que acontece quando alguém tenta agendar?" |
| **Repositórios (contratos)** | Definem *como* o núcleo pede para salvar e buscar dados, sem dizer *onde* | "Do que o caso de uso precisa para trabalhar?" |
| **Infra** | Implementações concretas: banco real, rotas HTTP | "Como isso funciona no mundo real?" |

---

## 3. Entidade x caso de uso

Essa distinção costuma confundir no começo:

- **Regra da entidade:** vale sempre, independente do contexto.
  *Ex.: um agendamento não pode terminar antes de começar.*
- **Regra do caso de uso:** depende de um contexto, geralmente de outros dados.
  *Ex.: não pode haver dois agendamentos no mesmo horário.* Para saber isso, é preciso consultar os agendamentos existentes, então a regra não cabe na entidade sozinha.

---

## 4. SOLID aplicado

### S: Single Responsibility (Responsabilidade Única)
Cada classe tem **um único motivo para mudar**. A entidade cuida de ser válida, o caso de uso cuida de uma ação e o repositório cuida de persistência.

### O: Open/Closed (Aberto/Fechado)
**Aberto para extensão, fechado para modificação.** Para trocar a forma de salvar dados, você *acrescenta* uma nova implementação em vez de editar o caso de uso.

### L: Liskov Substitution (Substituição de Liskov)
Qualquer implementação de um contrato (em memória, banco A, banco B) deve poder **substituir a outra** sem quebrar o sistema.

### I: Interface Segregation (Segregação de Interfaces)
Contratos **pequenos e focados**. Exponha só o que os casos de uso realmente usam, nada de interfaces "faz-tudo".

### D: Dependency Inversion (Inversão de Dependência) ⭐
**O princípio central desta arquitetura.**
- O caso de uso depende de uma **abstração** (o contrato do repositório), nunca de um banco concreto.
- A implementação concreta é **entregue de fora**, normalmente pelo construtor. Isso se chama *injeção de dependência*.
- Resultado: no teste você entrega uma versão falsa e simples. Em produção, entrega a real.

---

## 5. Por que isso facilita os testes?

### Repositório em memória
Nos testes, em vez de um banco de verdade, usa-se uma implementação do contrato que guarda os dados **numa lista na memória**. Ela é um tipo de *test double* (dublê de teste).

Vantagens:
- Os testes rodam em milissegundos.
- Não é preciso configurar nem limpar banco.
- Cada teste começa do zero, isolado dos outros.

### SUT (System Under Test)
É o "sistema sob teste", ou seja, a classe que o teste está exercitando.

### Estrutura de um bom teste (AAA)
1. **Arrange (Preparar):** montar os dados e dependências.
2. **Act (Agir):** executar a ação testada.
3. **Assert (Verificar):** conferir o resultado com `expect`.

### O que testar
- O **caminho feliz** (funciona quando deveria).
- Os **casos de erro** (falha quando deveria falhar). Cada regra de negócio merece pelo menos um teste que prove que ela é respeitada.

---

## 6. Pirâmide de testes

```
        /\
       /E2E\          poucos, lentos, caros (sobem tudo)
      /------\
     /Integração\     médio (banco real, HTTP real)
    /------------\
   /  Unitários   \   MUITOS, rápidos, baratos
  /----------------\
```

Como as regras não dependem de nada externo, **a maior parte dos testes pode ser unitária**. Esse é o grande ganho da arquitetura.

---

## 7. E o HTTP e o banco?

Entram **por último**, como *adaptadores*:

- A **rota HTTP** só traduz a requisição em uma chamada ao caso de uso e traduz o resultado em resposta.
- O **repositório real** é só mais uma implementação do mesmo contrato usado nos testes.

Nenhuma regra de negócio mora aqui. Se você perceber uma regra escrita dentro de uma rota, é sinal de que ela deveria estar no núcleo.

---

## 8. Erros comuns ao aprender

- **TS2564 – `Property has no initializer`**: o TypeScript exige que toda propriedade declarada na classe receba valor, normalmente no construtor.
- **Criar o objeto sem `new`**: um objeto literal `{ ... }` não é uma instância da classe, então getters e validações não são executados.
- **`toBeInstanceOf` na coisa errada**: verifique se está testando o *objeto* criado, e não uma propriedade dele (uma data não é instância de `Appointment`).
- **Nomes inconsistentes**: se a propriedade se chama de um jeito e o getter de outro, é fácil gerar bugs silenciosos.

---

## 9. Resumo para fixar

1. **Entidades** = o que o sistema *é*, com regras que valem sempre.
2. **Casos de uso** = o que o sistema *faz*, com regras que dependem de contexto.
3. **Contratos de repositório** = o núcleo depende *deles*, não do banco.
4. **Repositório em memória** = permite testar sem banco.
5. **Injeção de dependência** = permite trocar implementações (o D do SOLID).
6. **Framework e banco são detalhes** plugados nas bordas.
