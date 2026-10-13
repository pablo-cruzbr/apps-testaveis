import { Appointment } from "../entities/appointment";
import { AppointmentsRepository } from "../repositories/appointments-repository";

interface CreateAppoinmentRequest {
    customer: string
    startsAt: Date
    endsAt: Date
}

type CreateAppoimentResponse = Appointment

export class CreateAppoinment {
    constructor(private appointmentsRepository: AppointmentsRepository) {}

    async execute({ customer, startsAt, endsAt }: CreateAppoinmentRequest): Promise<CreateAppoimentResponse> {
        const appointment = new Appointment({
            customer,
            startsAt,
            endsAt
        })

        await this.appointmentsRepository.create(appointment)
        return appointment
    }
}