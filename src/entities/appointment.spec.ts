import { expect, test } from 'vitest'
import { Appointment } from './appointment'
import { getFutureDate } from '../tests/utils/get-future-date'

test('create an appointment', () => {
    const startsAt = getFutureDate('2026-05-10')
    const endsAt = getFutureDate('2026-05-11')

    const appointment = new Appointment({
        customer: 'John Doe',
        startsAt,
        endsAt
    })

    expect(appointment).toBeInstanceOf(Appointment)
    expect(appointment.customer).toEqual('John Doe')
})

test('cannot create an appoiment with end date before start date', () => {
    const startsAt = getFutureDate('2026-05-10')
    const endsAt = getFutureDate('2026-05-09')

    expect(() => {
        return new Appointment({
            customer: 'John Doe',
            startsAt,
            endsAt
        })
    }).toThrow()
})
