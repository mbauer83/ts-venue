import {BaseAggregate, type Aggregate, type VersionRange} from '@mbauer83/ts-eventsourcing/src/Aggregate.js';
import {AggregateReadRepository} from '@mbauer83/ts-eventsourcing/src/AggregateReadRepository.js';
import {
	type Command,
	CommandNotHandledError,
	CommandDoesNotApplyToAggregateVersionError,
	type BaseCommandPayload,
	GenericInitializationCommand,
	type BasicCommandPayload,
	GenericBasicCommand,
	type InitializationCommandPayload,
} from '@mbauer83/ts-eventsourcing/src/Command.js';
import {type Either, Left, Right} from '@mbauer83/ts-functional/src/Either.js';
import {IO} from '@mbauer83/ts-functional/src/IO.js';
import {AsyncIO} from '@mbauer83/ts-functional/src/AsyncIO.js';
import {type EventDispatcher} from '@mbauer83/ts-eventsourcing/src/EventDispatcher.js';
import {
	type DomainEvent,
	type InitializingDomainEvent,
	GenericInitializingDomainEvent,
	type BasicDomainEvent,
	GenericBasicDomainEvent,
	type BasicDomainEventPayload,
	isDomainEvent,
	isBasicDomainEvent,
	isInitializingDomainEvent,
} from '@mbauer83/ts-eventsourcing/src/DomainEvent.js';
import {extractForQuery, type Query} from '@mbauer83/ts-eventsourcing/src/Query.js';
import {type AggregateEventFilterData, InMemoryDomainEventStorage} from '@mbauer83/ts-eventsourcing/src/EventStorage.js';
import {type EventListener} from '@mbauer83/ts-eventsourcing/src/EventListener.js';
import {defaultEventDispatcher} from '@mbauer83/ts-eventsourcing/src/EventDispatcher.js';
import {instanceToPlain} from 'class-transformer';
import {None, Some} from '@mbauer83/ts-functional/src/Optional.js';
import {AsyncTask} from '@mbauer83/ts-functional/src/AsyncTask.js';
import {type Task} from '@mbauer83/ts-functional/src/Task.js';
import {type DateRange} from '@mbauer83/ts-utils/src/date/DateRange.js';

/**  DEFINITIONS **/

const taskToAsyncTask = <E, O>(t: Task<E, O>): AsyncTask<E, O> => new AsyncTask<E, O>(async () => t.evaluate());

const noneDateRange: None<DateRange> = None.for<DateRange>();
const noneVersionRange: None<VersionRange> = None.for<VersionRange>();

// Define the types of three hierarchical aggregates: VenueSeat, VenueSection, and Venue.
// Venue is the aggregate root, VenueSection is a child of Venue, and VenueSeat is a child of VenueSection.

// Aggregate-types are reified as strings-literal types, so we can use them as type parameters.
type VenueSeatType = 'VenueSeat';
type VenueSectionType = 'VenueSection';
type VenueType = 'Venue';

// Aggregates are parameterized by their aggregate-type-name and their state-type,
// so these can be replaced independently of the surrounding aggregate-logic.
class VenueSeatState {
	constructor(public readonly accessible: boolean) {}
}

class VenueSeat extends BaseAggregate<VenueSeatType, VenueSeatState> implements Aggregate<VenueSeatType, VenueSeatState> {
	constructor(id: string, state: VenueSeatState, version = 0) {
		super('VenueSeat', id, state, version);
	}

	// Since commands are handled by the aggregate root, no events are emitted by this aggregate.
	protected eventsForCommand<T extends BaseCommandPayload<VenueSeatType>>(command: Command<VenueSeatType, VenueSeatState, T>): Either<Error, Array<BasicDomainEvent<VenueSeatType, VenueSeatState, any>>> {
		return new Left(new CommandNotHandledError(command.constructor.name, this.constructor.name));
	}

	protected withState(s: VenueSeatState, newVersion: number): VenueSeat {
		return new VenueSeat(this.id, s, newVersion);
	}
}

class VenueSectionState {
	constructor(public readonly sectionName: string, public readonly seats: Record<string, VenueSeat>) {}
}

class VenueSection extends BaseAggregate<VenueSectionType, VenueSectionState> implements Aggregate<VenueSectionType, VenueSectionState> {
	constructor(id: string, state: VenueSectionState, version = 0) {
		super('VenueSection', id, state, version);
	}

	// Since commands are handled by the aggregate root, no events are emitted by this aggregate.
	protected eventsForCommand<T extends BaseCommandPayload<VenueSectionType>>(command: Command<VenueSectionType, VenueSectionState, T>): Either<Error, Array<BasicDomainEvent<VenueSectionType, VenueSectionState, any>>> {
		return new Left(new CommandNotHandledError(command.constructor.name, this.constructor.name));
	}

	protected withState(state: VenueSectionState, newVersion: number): VenueSection {
		return new VenueSection(this.id, state, newVersion);
	}
}

class VenueState {
	constructor(public readonly venueName: string, public readonly venueSections: Record<string, VenueSection>) {}
}

class Venue extends BaseAggregate<VenueType, VenueState> implements Aggregate<VenueType, VenueState> {
	constructor(id: string, state: VenueState, version = 0) {
		super('Venue', id, state, version);
	}

	protected eventsForCommand<T extends BaseCommandPayload<VenueType>>(
		command: Command<VenueType, VenueState, T>,
	): Either<Error, Array<BasicDomainEvent<VenueType, VenueState, any>>> {
		if (command instanceof SetVenueSeatAccessibility) {
			const appliesToVersion = command.appliesToVersion();
			if (appliesToVersion !== this.version) {
				return new Left(new CommandDoesNotApplyToAggregateVersionError(
					this.constructor.name,
					this.id,
					appliesToVersion,
					this.version,
				));
			}

			const evtPayload: BasicDomainEventPayload<VenueType> & {
				seatId: string;
				accessibility: boolean;
			} = {
				accessibility: command.payload.accessibility,
				seatId: command.payload.seatId,
				newAggregateVersion: this.version + 1,
				aggregateTypeName: 'Venue',
				aggregateId: this.id,
			};
			const evt = new VenueSeatAccessibilityChanged(command.id, this.id, evtPayload, new Date(), 'test');
			return new Right(
				[evt as BasicDomainEvent<VenueType, VenueState, any>],
			) as Either<Error, Array<BasicDomainEvent<VenueType, VenueState, any>>>;
		}

		return new Left(new CommandNotHandledError(command.constructor.name, this.constructor.name));
	}

	protected withState(state: VenueState, newVersion: number): Venue {
		return new Venue(this.id, state, newVersion);
	}
}

// Helper function for creating a venueSeat from a CreateVenueSeat command
const venueSeatFromCommand = (c: CreateVenueSeat, dispatcher: EventDispatcher) => {
	const agg = new VenueSeat(c.getAggregateId(), c.getState());
	const evt = new GenericInitializingDomainEvent(c.id, {
		aggregateTypeName: 'VenueSeat',
		aggregateId: c.getAggregateId(),
		snapshot: agg,
	}, c.metadata);
	return [new IO<Aggregate<'VenueSeat', VenueSeatState>>(() => agg), dispatcher.dispatchEvents(evt)];
};

// Define Commands
class CreateVenueSeat extends GenericInitializationCommand<VenueSeatType, VenueSeatState, InitializationCommandPayload<VenueSeatType, VenueSeatState>> {
	constructor(id: string, aggregateId: string, state: VenueSeatState, createdAt: Date, issuer: string) {
		super(id, {aggregateTypeName: 'VenueSeat', aggregateId, state}, createdAt, issuer);
	}
}

class SetVenueSeatAccessibility extends GenericBasicCommand<VenueType, VenueState, BasicCommandPayload<VenueType> & {
	seatId: string;
	accessibility: boolean;
}> {
	// eslint-disable-next-line max-params
	constructor(
		id: string,
		aggregateId: string,
		appliesToVersion: number,
		createdAt: Date,
		issuer: string,
		public readonly seatId: string,
		public readonly accessibility: boolean,
	) {
		super(id, {
			aggregateTypeName: 'Venue',
			seatId,
			aggregateId,
			appliesToVersion,
			accessibility,
		}, createdAt, issuer);
	}
}

// Define Events
class VenueSeatAccessibilityChanged extends GenericBasicDomainEvent<VenueType, VenueState, BasicDomainEventPayload<VenueType> & {
	accessibility: boolean;
}> {
	constructor(id: string, aggregateId: string, payload: BasicDomainEventPayload<VenueType> & {
		seatId: string;
		accessibility: boolean;
	}, createdAt: Date, issuer: string) {
		const applicator = (state: VenueState) => {
			for (const [sectionName, section] of Object.entries(state.venueSections)) {
				const seat = section.state.seats[payload.seatId] ?? undefined;
				if (seat) {
					const newSeats = {...section.state.seats};
					newSeats[payload.seatId] = new VenueSeat(seat.id, new VenueSeatState(payload.accessibility), seat.version + 1);
					const newSection = new VenueSection(
						section.id,
						new VenueSectionState(section.state.sectionName, newSeats),
						section.version + 1,
					);
					const newSections = {...state.venueSections};
					newSections[section.id] = newSection;
					return new VenueState(state.venueName, newSections);
				}
			}

			return state;
		};

		super(id, payload, {
			aggregateTypeName: 'VenueSeat',
			aggregateId,
			timestampMs: createdAt.getTime(),
			issuer,
		}, applicator);
	}
}

const getVenueCreatedEvent = (v: Venue) => new GenericInitializingDomainEvent('venue-created-001', {
	aggregateTypeName: 'Venue',
	aggregateId: v.id,
	snapshot: v,
}, {
	issuer: 'test',
	timestampMs: Date.now(),
});

const createAndPushVenueCreatedEventTask = (v: Venue): Task<Error, Venue> => {
	const evt = getVenueCreatedEvent(v);
	return defaultEventDispatcher.dispatchEvents(evt).map(() => v);
};

/**  SCENARIO **/

// SETUP

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
	'venue-001',
	0,
	new Date(),
	'test',
	'seat-002',
	true,
);

// Create Query for the accessible-property of seat 2 in section 1
const queryForSeat2Accessibility: Query<VenueType, Venue> = {
	targetType: 'Venue',
	targetId: 'venue-001',
	metadata: {timestampMs: Date.now(), issuer: 'test'},
	extractionPathsWithLabels: [
		['state.venueSections.section-001.state.seats.seat-002.state.accessible', 'seat2Accessibility'],
	],
};

// Bootstrap EventStorage
const inMemoryDomainEventStore = new InMemoryDomainEventStorage();

class InMemoryEventStorageWriter implements EventListener<any, DomainEvent<any, any, any>> {
	eventTypes = ['any'];

	constructor(private readonly store: InMemoryDomainEventStorage) {}

	react(event: DomainEvent<any, any, any>) {
		return this.store.storeEvents(event);
	}
}

// Bootstrap EventListeners
class CreateSeatListener implements EventListener<[VenueSeatType], DomainEvent<VenueSeatType, any, any>> {
	eventTypes = ['VenueSeat'] as [VenueSeatType];

	react(event: DomainEvent<VenueSeatType, any, any>) {
		const resolver = async () => {
			if (event.isInitial()) {
				const aggregate = (event as InitializingDomainEvent<VenueSeatType, VenueSeatState, any>).getSnapshot();
				const serializedAggregate = JSON.stringify(instanceToPlain(aggregate));
				return new Right<Error, void>(undefined);
			}

			return new Right<Error, void>(undefined);
		};

		return new AsyncTask<Error, void>(resolver);
	}
}

// Register listeners
const registerListenersTask = defaultEventDispatcher.registerListeners(new InMemoryEventStorageWriter(
	inMemoryDomainEventStore), new CreateSeatListener());

// Create two seats from initialization-commands
const venueSeatCreateTuple1: [IO<VenueSeat>, Task<Error, void>] = venueSeatFromCommand(
	createSeatCommand01,
	defaultEventDispatcher,
) as [IO<VenueSeat>, Task<Error, void>];

const venueSeatCreateTuple2: [IO<VenueSeat>, Task<Error, void>] = venueSeatFromCommand(
	createSeatCommand02,
	defaultEventDispatcher,
) as [IO<VenueSeat>, Task<Error, void>];

const [venueSeat1, venueSeatCreateEventDispatchTask1] = venueSeatCreateTuple1;
const [venueSeat2, venueSeatCreateEventDispatchTask2] = venueSeatCreateTuple2;

// Define IOs and Tasks
const createVenueSection1IO = venueSeat1.zip(venueSeat2).map(seats =>
	new VenueSection('section-001', new VenueSectionState('section-001', {[seats[0].id]: seats[0], [seats[1].id]: seats[1]})),
);

const createVenue1IO: IO<Venue> = createVenueSection1IO.map(section =>
	new Venue('venue-001', new VenueState('venue-001', {[section.id]: section})),
);

const createAndPushVenue1Task = createVenue1IO.mapToTask(venue => createAndPushVenueCreatedEventTask(venue).evaluate());

const createEverythingTask = venueSeat1.thenDoIO(venueSeat2).thenDoIO(createVenueSection1IO).thenDoTask(createAndPushVenue1Task);

const changedVenueOrError: Task<Error, Venue> = createVenue1IO.mapToTask((venue: Venue): Either<Error, Venue> =>
	venue.tryApplyCommand(setSeat2Accessible, defaultEventDispatcher).map((newAggregate: Aggregate<any, any>): Venue => {
		console.log('changedVenue:');
		console.log(JSON.stringify(newAggregate, null, 2));
		console.log();
		return newAggregate as Venue;
	}).evaluate(),
);

const venueReadRepository = new AggregateReadRepository<VenueType, Venue>('Venue', inMemoryDomainEventStore);
const getVenueFromMemoryAsyncTask = taskToAsyncTask(venueReadRepository.get('venue-001'));

const performQueryBeforeChangeAsyncTask = getVenueFromMemoryAsyncTask.map(async venue => {
	const extractionResult = extractForQuery(queryForSeat2Accessibility, venue);
	console.log('Query result - venue seat 2 accessibility:');
	console.log(JSON.stringify(extractionResult, null, 2));
	return undefined;
});

const performQueryAfterChangeAsyncTask = performQueryBeforeChangeAsyncTask;

// Get async event-producing generators for VenueSeat and Venue, iterate over them and print results
const allGeneratorTask = inMemoryDomainEventStore.produceEventsForTypesAsync<['VenueSeat', 'Venue'], [AggregateEventFilterData<'VenueSeat'>, AggregateEventFilterData<'Venue'>]>(
	[
		{
			type: 'VenueSeat',
			aggregateId: None.for<string>(),
			dateRange: None.for<DateRange>(),
			versionRange: None.for<VersionRange>(),
		},
		{
			type: 'Venue',
			aggregateId: None.for<string>(),
			dateRange: None.for<DateRange>(),
			versionRange: None.for<VersionRange>(),
		},
	],
);

const consoleLoggingGeneratorTask = allGeneratorTask.map(async gens => {
	const gen0 = gens.VenueSeat as AsyncGenerator<DomainEvent<VenueSeatType, VenueSeatState, any>, void, any>;
	const gen1 = gens.Venue as AsyncGenerator<DomainEvent<VenueType, VenueState, any>, void, any>;
	console.log('Getting events from async generators for VenueSeat and Venue');
	for await (const evt of gen0) {
		console.log('Got event from async generator for VenueSeat');
		console.log(JSON.stringify(evt, null, 2));
		console.log();
	}

	for await (const evt of gen1) {
		console.log('Got event from async generator for Venue');
		console.log(JSON.stringify(evt, null, 2));
		console.log();
	}
});

const printDoneIO = new AsyncIO<void>(async () => {
	console.log('Done');
});

// Compose program
const composedProgram
    = taskToAsyncTask(
    		registerListenersTask
    		.thenDoTask(createEverythingTask)
    		.thenDoTask(venueSeatCreateEventDispatchTask1)
    		.thenDoTask(venueSeatCreateEventDispatchTask2)
    		.thenDoTask(changedVenueOrError),
    	)
    	.thenDoTask(consoleLoggingGeneratorTask)
    	.thenDoTask(performQueryAfterChangeAsyncTask)
    	.thenDoIO(printDoneIO);

console.log('starting execution...');
// Nothing has been executed so far -
// all effects happen at the edge of the application
// when this next line is executed.
void composedProgram.evaluate();
console.log('after call to `composedProgram.evaluate`'); // This will be printed before all effects have executed
