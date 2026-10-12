import { Appointment } from "../entities/appointment";

interface CreateAppoinmentRequest {
    customer: string
    startsAt: Date
    endsAt: Date
}

type CreateAppoimentResponse = Appointment

export class CreateAppoinment {
    async execute({ customer, startsAt, endsAt }: CreateAppoinmentRequest): Promise<CreateAppoimentResponse> {
        const appointment = new Appointment({
            customer,
            startsAt,
            endsAt
        })
        return appointment
    }
}