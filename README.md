# ts-venue

`ts-venue` provides an example for usage of the `ts-eventsourcing` library.

## Usage
After cloning this repo and running `npm install`, execute `npm run lint && npm run build && npm run scenario`.

Alternatively, you can also just execute `npm run scenario` after cloning and installing.

The console readout will show that two instances of `VenueSeat` were created, then the `Venue` to which they indirectly belong was changed by changing the `accessible` property of the second `VenueSeat`.
The changing of the seat's accessibility-status happens on the `Venue` itself, because it is the aggregate-root to which `VenueSection` belongs, which in turn owns the seats.
As the readout also shows, this automatically causes an update of the `version` property of the involved aggregates (seat, section and venue). 
