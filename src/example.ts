import {BaseAggregate, type Aggregate, type AggregateType, AggregateMustBeCreatedFromFactoryError} from '@mbauer83/ts-eventsourcing/src/Aggregate.js';
import {type Command, CommandNotHandledError, CommandDoesNotApplyToAggregateVersionError, type BaseCommandPayload, GenericInitializationCommand, type BasicCommandPayload, GenericBasicCommand, type InitializationCommand, type InitializationCommandPayload} from '@mbauer83/ts-eventsourcing/src/Command.js';
import {type Either, Left, Right} from '@mbauer83/ts-functional/src/Either.js';
import {type EventDispatcher} from '@mbauer83/ts-eventsourcing/src/EventDispatcher.js';
import {type DomainEvent, type InitializingDomainEvent, GenericInitializingDomainEvent, type BasicDomainEvent, GenericBasicDomainEvent, type BasicDomainEventPayload} from '@mbauer83/ts-eventsourcing/src/DomainEvent.js';
import {InMemoryDomainEventStorage} from '@mbauer83/ts-eventsourcing/src/EventStorage.js';
import {type EventListener} from '@mbauer83/ts-eventsourcing/src/EventListener.js';
import {defaultEventDispatcher} from '@mbauer83/ts-eventsourcing/src/EventDispatcher.js';
import {instanceToPlain} from 'class-transformer';
import {None} from '@mbauer83/ts-functional/src/Optional.js';

// Define the types of three hierarchical aggregates: VenueSeat, VenueSection, and Venue.
// Vanue is the aggregate root, VenueSection is a child of Venue, and VenueSeat is a child of VenueSection.
type VenueSeatType = 'VenueSeat';
type VenueSectionType = 'VenueSection';
type VenueType = 'Venue';

class VenueSeatState {
	constructor(public readonly accessible: boolean) {}
}

class VenueSeat extends BaseAggregate<VenueSeatType, VenueSeatState> implements Aggregate<VenueSeatType, VenueSeatState> {
	constructor(id: string, state: VenueSeatState, version = 0) {
		super('VenueSeat', id, state, version);
	}

	// Since commands are handled by the root, no events are emitted by this aggregate.
	protected eventsForCommand<T extends BaseCommandPayload<VenueSeatType>>(command: Command<VenueSeatType, VenueSeatState, T>): Either<Error, Array<BasicDomainEvent<VenueSeatType, VenueSeatState, any>>> {
		return new Left(new CommandNotHandledError(command.constructor.name, this.constructor.name));
	}

	protected withState(s: VenueSeatState, newVersion: number): VenueSeat {
		return new VenueSeat(this.id, s, newVersion);
	}
}

class VenueSectionState {
	constructor(public readonly sectionName: string, public readonly seats: VenueSeat[]) {}
}

class VenueSection extends BaseAggregate<VenueSectionType, VenueSectionState> implements Aggregate<VenueSectionType, VenueSectionState> {
	constructor(id: string, state: VenueSectionState, version = 0) {
		super('VenueSection', id, state, version);
	}

	// Since commands are handled by the root, no events are emitted by this aggregate.
	protected eventsForCommand<T extends BaseCommandPayload<VenueSectionType>>(command: Command<VenueSectionType, VenueSectionState, T>): Either<Error, Array<BasicDomainEvent<VenueSectionType, VenueSectionState, any>>> {
		return new Left(new CommandNotHandledError(command.constructor.name, this.constructor.name));
	}

	protected withState(state: VenueSectionState, newVersion: number): VenueSection {
		return new VenueSection(this.id, state, newVersion);
	}
}

class VenueState {
	constructor(public readonly venueName: string, public readonly venueSections: VenueSection[]) {}
}

class Venue extends BaseAggregate<VenueType, VenueState> implements Aggregate<VenueType, VenueState> {
	constructor(id: string, state: VenueState, version = 0) {
		super('Venue', id, state, version);
	}

	protected eventsForCommand<T extends BaseCommandPayload<VenueType>>(command: Command<VenueType, VenueState, T>): Either<Error, Array<BasicDomainEvent<VenueType, VenueState, any>>> {
		if (command instanceof SetVenueSeatAccessibility) {
			if (command.appliesToVersion !== this.version) {
				return new Left(new CommandDoesNotApplyToAggregateVersionError(this.constructor.name, this.id, command.appliesToVersion, this.version));
			}

			const evtPayload: BasicDomainEventPayload<VenueType> & {accessibility: boolean} = {accessibility: command.payload.accessibility, newAggregateVersion: this.version + 1, aggregateTypeName: 'Venue', aggregateId: this.id};
			const evt = new VenueSeatAccessibilityChanged(command.id, this.id, evtPayload, new Date(), 'test');
			return new Right([evt as BasicDomainEvent<VenueType, VenueState, any>]) as Either<Error, Array<BasicDomainEvent<VenueType, VenueState, any>>>;
		}

		return new Left(new CommandNotHandledError(command.constructor.name, this.constructor.name));
	}

	protected withState(state: VenueState): Venue {
		return new Venue(this.id, state);
	}
}

// Helper function for creating a venueSeat from a CreateVenueSeat command
const venueSeatFromCommand = (c: CreateVenueSeat, dispatcher: EventDispatcher) => {
	const agg = new VenueSeat(c.aggregateId, c.state);
	const evt = new GenericInitializingDomainEvent(c.id, {aggregateTypeName: 'VenueSeat', aggregateId: c.aggregateId, snapshot: agg}, c.metadata);
	dispatcher.dispatchEvents(evt);
	return agg;
};

// Define Commands
class CreateVenueSeat extends GenericInitializationCommand<VenueSeatType, VenueSeatState, InitializationCommandPayload<VenueSeatType, VenueSeatState>> {
	constructor(id: string, aggregateId: string, state: VenueSeatState, createdAt: Date, issuer: string) {
		super(id, {aggregateTypeName: 'VenueSeat', aggregateId, state}, createdAt, issuer);
	}
}

class SetVenueSeatAccessibility extends GenericBasicCommand<VenueType, VenueState, BasicCommandPayload<VenueType> & {accessibility: boolean}> {
	constructor(id: string, aggregateId: string, appliesToVersion: number, createdAt: Date, issuer: string, public readonly accessibility: boolean) {
		super(id, {aggregateTypeName: 'Venue', aggregateId, appliesToVersion, accessibility}, createdAt, issuer);
	}
}

// Define Events
class VenueSeatAccessibilityChanged extends GenericBasicDomainEvent<VenueType, VenueState, BasicDomainEventPayload<VenueType> & {accessibility: boolean}> {
	constructor(id: string, aggregateId: string, payload: BasicDomainEventPayload<VenueType> & {accessibility: boolean}, createdAt: Date, issuer: string) {
		const applicator = (state: VenueState) => {
			const sections = state.venueSections;
			for (const section of sections) {
				const seat = section.state.seats.find(seat => seat.id === aggregateId);
				if (seat) {
					const newSeats = section.state.seats.map(seat => (seat.id === aggregateId ? new VenueSeat(seat.id, new VenueSeatState(payload.accessibility)) : seat));
					const newSection = new VenueSection(section.id, new VenueSectionState(section.state.sectionName, newSeats), section.version + 1);
					const newSections = state.venueSections.map(s => (s.id === section.id ? newSection : s));
					return new VenueState(state.venueName, newSections);
				}
			}

			return state;
		};

		super(id, payload, {aggregateTypeName: 'VenueSeat', aggregateId, timestampMs: createdAt.getTime(), issuer}, applicator);
	}
}

// Construct commands
const createSeatCommand01 = new CreateVenueSeat(
	'create-seat-command-001',
	'seat-001',
	new VenueSeatState(true),
	new Date(),
	'test',
);

const createSeatCommand02 = new CreateVenueSeat(
	'create-seat-command-002',
	'seat-002',
	new VenueSeatState(false),
	new Date(),
	'test',
);

const setSeat2Accessible = new SetVenueSeatAccessibility(
	'set-seat-002-accessible',
	'seat-002',
	0,
	new Date(),
	'test',
	true,
);

// Bootstrap EventStorage
const inMemoryDomainEventStore = new InMemoryDomainEventStorage();

class InMemoryEventStorageWriter implements EventListener<any> {
	eventTypes = ['any'];
	constructor(private readonly store: InMemoryDomainEventStorage) {}
	async react(event: DomainEvent<any, any, any>) {
		await this.store.storeEvents(event);
	}
}

// Bootstrap EventListeners
class CreateSeatListener implements EventListener<VenueSeatType> {
	eventTypes = ['VenueSeat'] as VenueSeatType[];
	async react(event: DomainEvent<VenueSeatType, any, any>) {
		if (event.isInitial()) {
			const aggregate = (event as InitializingDomainEvent<VenueSeatType, VenueSeatState, any>).snapshot;
			const serializedAggregate = JSON.stringify(instanceToPlain(aggregate));
			console.log('venue seat created. id: [' + event.getAggregateId() + '] - entity: [' + serializedAggregate + ']');
			return;
		}

		console.log('venue seat updated. id: [' + event.getAggregateId() + ']');
	}
}

defaultEventDispatcher.registerListeners(new InMemoryEventStorageWriter(inMemoryDomainEventStore), new CreateSeatListener());

// Create two seats from initialization-commands
const venueSeat1 = venueSeatFromCommand(createSeatCommand01, defaultEventDispatcher);
const venueSeat2 = venueSeatFromCommand(createSeatCommand02, defaultEventDispatcher);

// Create new section containing the seats and venue containing the section manually
const venueSection1 = new VenueSection('section-001', new VenueSectionState('section-001', [venueSeat1, venueSeat2]));
const venue1 = new Venue('venue-001', new VenueState('venue-001', [venueSection1]));

// Try to apply a command to the venue
const changedVenueOrError = venue1.tryApplyCommand(setSeat2Accessible, defaultEventDispatcher);
console.log('changedVenueOrError:');
console.log(changedVenueOrError);

const noneString = new None<string>();
const noneNumber = new None<number>();
const noneDate = new None<Date>();

// Get async event-producing generators for VenueSeat and Venue, iterate over them and print results
const allGenerator = inMemoryDomainEventStore.produceEventsForTypesAsync([['VenueSeat', noneString, noneNumber], ['Venue', noneString, noneNumber]], noneDate);
const allGenAsRecord: Record<string, AsyncGenerator<DomainEvent<any, any, any>, void, any>> = allGenerator as unknown as Record<string, AsyncGenerator<DomainEvent<any, any, any>, void, any>>;
const genKeys = Object.keys(allGenerator);
console.log('genKeys:');
console.log(genKeys);
async function doIterate() {
	const gen0 = allGenAsRecord.VenueSeat as AsyncGenerator<DomainEvent<VenueSeatType, VenueSeatState, any>, void, any>;
	const gen1 = allGenAsRecord.Venue as AsyncGenerator<DomainEvent<VenueType, VenueState, any>, void, any>;
	for await (const evt of gen0) {
		console.log('Got event from async generator for VenueSeat');
		console.log(evt);
	}

	for await (const evt of gen1) {
		console.log('Got event from async generator for Venue');
		console.log(evt);
	}
}

await doIterate();
