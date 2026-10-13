import { describe, expect, it } from 'vitest'
import { Appointment } from '../entities/appointment'
import { getFutureDate } from '../tests/utils/get-future-date'
import { CreateAppoinment } from './create-appoinment'
import { InMemoryAppointmentsRepository } from '../repositories/in-memory/in-memory-appoinments-repository'

describe('Create Appointment', () => {
    it('should be able to create an appointment', async () => {
        const appointmentsRepository = new InMemoryAppointmentsRepository()
        const createAppoinment = new CreateAppoinment(appointmentsRepository)

        const startsAt = getFutureDate('2022-08-10')
        const endsAt = getFutureDate('2022-08-11')

        await expect(createAppoinment.execute({
            customer: 'John Doe',
            startsAt,
            endsAt
        })).resolves.toBeInstanceOf(Appointment)
    })

    it('should not be able to create an appointment with end date before start date', async () => {
        const appointmentsRepository = new InMemoryAppointmentsRepository()
        const createAppoinment = new CreateAppoinment(appointmentsRepository)

        const startsAt = getFutureDate('2022-08-11')
        const endsAt = getFutureDate('2022-08-10')

        await expect(createAppoinment.execute({
            customer: 'John Doe',
            startsAt,
            endsAt
        })).rejects.toBeInstanceOf(Error)
    })
})
