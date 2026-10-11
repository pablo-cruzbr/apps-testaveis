export interface AppointmentProps {
    customer: string
    startsAt: Date
    endAt: Date
}

export class Appointment {
    private props: AppointmentProps

    get customer () {
        return this.props.customer
    }

    get startsAt () {
        return this.props.startsAt
    }

    get endAt () {
        return this.props.endAt
    }

    constructor (props: AppointmentProps) {
        this.props = props
    }
}