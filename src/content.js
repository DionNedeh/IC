// Tour copy, camera stops, callouts and part descriptions. Figures are typical
// published values for Westinghouse ice condenser plants and vary by unit;
// treat them as approximate. Angles are degrees, distances metres.

import { ANCHORS, DIM } from './plant.js';
import { polar, DEG } from './math.js';
import { PERIOD } from './flow.js';

export const STOPS = [
  {
    id: 'overview',
    title: 'Ice condenser containment',
    body: [
      'A pressurized-water reactor building that wraps the reactor in a 300° ring of borated ice. If a coolant pipe breaks, the steam can only reach the upper building by passing through that ice, and most of it condenses on the way.',
      'Absorbing the energy this way lets the structure be about half the volume, and about a quarter of the design pressure, of a conventional large dry containment.',
      'Click or tap any part of the model to identify it, or open Layers to peel the building apart and find a part by name.',
    ],
    figures: [['1,944', 'ice baskets'], ['24', 'bays over ≈300°'], ['> 2 million lb', 'of ice (≈1,000 t)']],
    view: { az: 21, el: 15, dist: 'fit', target: [0, 26.5, 0] },
    callouts: [
      ['iceBed', 'Ice bed'],
      ['shield', 'Concrete shield building'],
      ['vessel', 'Steel containment vessel'],
      ['craneWall', 'Crane wall'],
      ['upper', 'Upper compartment'],
      ['lower', 'Lower compartment'],
      ['person', 'Person, for scale'],
    ],
  },
  {
    id: 'compartments',
    title: 'Two compartments, one way through',
    body: [
      'A divider barrier splits the building in two. The lower compartment holds the reactor coolant system; the upper compartment is a large, empty expansion volume. The barrier is the operating deck, the crane wall, and the enclosures that box in the tops of the steam generators and the pressurizer.',
      'The only large opening between the two is the ice condenser. Steam released below has to push through the ice to get above, which is the whole idea of the design.',
    ],
    figures: [['2', 'compartments'], ['3', 'sets of doors in the path']],
    view: { az: 16, el: 24, dist: 'fit', target: [0, 24, 0] },
    callouts: [
      ['deck', 'Divider deck'],
      ['sgEnclosure', 'Steam generator enclosure'],
      ['craneWall', 'Crane wall'],
      ['dome', 'Upper compartment'],
      ['lower', 'Lower compartment'],
      ['iceBed', 'Ice condenser: the only path up'],
    ],
  },
  {
    id: 'rcs',
    title: 'Where the steam would come from',
    body: [
      'Four coolant loops circle the reactor vessel. In each, a pump drives water at about 15.5 MPa (2,250 psi) through the core and on through a steam generator. The water enters the core near 290 °C and leaves near 325 °C, and the pressurizer keeps it from boiling.',
      'A break in one of these pipes lets that water flash to steam in the lower compartment. Everything else in this building exists to deal with that.',
    ],
    figures: [['4', 'coolant loops'], ['≈ 15.5 MPa', 'operating pressure'], ['≈ 3,400 MW', 'thermal power']],
    view: { az: 5, el: 17, dist: 52, target: [0, 8.5, 1.0] },
    callouts: [
      ['reactor', 'Reactor vessel'],
      ['crdm', 'Control rod drives'],
      ['hotLeg', 'Hot leg'],
      ['rcp', 'Reactor coolant pump'],
      ['steamGen', 'Steam generator'],
      ['sump', 'Containment sump'],
    ],
  },
  {
    id: 'bed',
    title: 'The ice bed',
    body: [
      'Each bay holds 81 perforated steel baskets, roughly 12 in (0.3 m) across and 48 ft (14.6 m) tall, packed with flake ice frozen from a sodium tetraborate solution. Lattice frames every six feet or so keep the columns aligned and leave flow passages between them.',
      'The perforations expose a very large ice surface to passing steam. The borate keeps the meltwater alkaline, which helps hold radioactive iodine in the sump water.',
    ],
    figures: [['81', 'baskets per bay'], ['48 ft', 'basket height'], ['≤ 27 °F', 'bed temperature limit']],
    view: { az: 47, el: 6, dist: 54, target: polar(15.2, 44 * DEG, 22.0) },
    callouts: [
      ['iceBed', 'Ice baskets'],
      ['latticeFrame', 'Lattice frame'],
      ['midDeck', 'Intermediate deck'],
      ['lowerPlenum', 'Lower plenum'],
    ],
  },
  {
    id: 'doors',
    title: 'Lower inlet doors',
    body: [
      'Twenty-four pairs of insulated doors in the crane wall separate the warm lower compartment from the ice. They are designed to swing open on a pressure difference of only about one pound per square foot, so even a small break opens a path into the bed.',
      'Just inside, turning vanes redirect the incoming flow upward. Floor drains carry meltwater back down to the containment sump.',
    ],
    figures: [['48', 'doors in 24 pairs'], ['≈ 1 lb/ft²', 'to open']],
    view: { az: 45, el: 6, dist: 20, target: polar(14.6, 43 * DEG, 12.3) },
    callouts: [
      ['lowerDoor', 'Lower inlet doors'],
      ['vane', 'Turning vane'],
      ['accumulator', 'Accumulator'],
    ],
  },
  {
    id: 'plenum',
    title: 'Decks and refrigeration',
    body: [
      'Above the baskets, hinged intermediate deck doors and a top deck of flexible insulated blankets close off the upper plenum. Both lift under flow from below and otherwise keep warm, humid air away from the ice.',
      'Air handling units in the plenum, cooled by a chilled glycol loop, hold the bed well below freezing. Ice still sublimates slowly and migrates as frost, so plants weigh baskets, replenish ice and check the flow passages on a schedule, working from a small bridge crane that travels round the plenum.',
    ],
    figures: [['15–20 °F', 'typical bed temperature'], ['Glycol', 'chilled coolant loop']],
    view: { az: 41, el: 8, dist: 19, target: polar(15.0, 39 * DEG, 32.2) },
    callouts: [
      ['ahu', 'Air handling unit'],
      ['glycol', 'Glycol headers'],
      ['topDeck', 'Top deck'],
      ['midDeck', 'Intermediate deck doors'],
      ['bridgeCrane', 'Bridge crane'],
    ],
  },
  {
    id: 'sequence',
    title: 'When a pipe breaks',
    body: ['An illustrative run of the first moments of a loss-of-coolant accident. Timing is compressed and the flow is schematic; this is not a simulation. Play it, drag the slider, or pick a step.'],
    steps: [
      'Steam floods the lower compartment.',
      'Pressure pushes the lower inlet doors open.',
      'Steam rises through the bed and condenses on the ice.',
      'Air and leftover vapour lift the deck doors into the upper compartment.',
      'Meltwater drains to the sump. After about ten minutes, air return fans push upper-compartment air back down through the ice.',
    ],
    sequence: true,
    view: { az: 25, el: 12, dist: 'fit', target: [0, 26.5, 0] },
    callouts: [
      ['lower', 'Break in a coolant loop'],
      ['iceBed', 'Condensing in the ice bed'],
      ['upper', 'Upper compartment'],
    ],
  },
  {
    id: 'longterm',
    title: 'After the ice',
    body: [
      'The ice handles the first surge. For the longer term, spray headers under the dome cool the upper compartment, drawing first on a storage tank outside and then on water recirculated from the sump, where meltwater and spilled coolant collect.',
      'Air return fans start after a delay and push upper-compartment air back down so it passes through the ice again. Glow-plug igniters, added after Three Mile Island, burn off hydrogen in small amounts before it can build up in the smaller building.',
      'Show the sprays and the air return path to watch both at work. Like the pipe-break sequence, this is a schematic, not a simulation.',
    ],
    cooling: true,
    figures: [['≈ 10 min', 'fan start delay'], ['2', 'air return fans']],
    view: { az: -14, el: 33, dist: 'fit', target: [0, 24, 0] },
    callouts: [
      ['spray', 'Containment spray headers'],
      ['igniter', 'Hydrogen igniter'],
      ['airFan', 'Air return fan'],
      ['sump', 'Containment sump'],
      ['rwst', 'Refuelling water storage tank'],
    ],
  },
  {
    id: 'tradeoffs',
    title: 'What the ice buys, and costs',
    body: [
      'Design pressure is around 12–15 psig, against roughly 45–60 psig for a large dry containment, inside a free volume of about 1.2 million ft³. The price is upkeep: refrigeration, ice weighing and door testing for the life of the plant.',
      'A smaller building also concentrates hydrogen sooner in a severe accident, which is why the igniters were added. Ten U.S. units at five sites use the design (D.C. Cook, Sequoyah, McGuire, Catawba, Watts Bar), as do Loviisa in Finland and the retired Ohi 1 and 2 in Japan.',
    ],
    figures: [['12–15 psig', 'design pressure'], ['10', 'U.S. units, 5 sites']],
    view: { az: 12, el: 48, dist: 'fit', target: [0, 25, 0] },
    callouts: [
      ['topDeck', 'Top deck over the ice'],
      ['crane', 'Polar crane'],
      ['steamGen', 'Steam generator enclosure'],
      ['refuel', 'Refuelling machine'],
      ['glycolRiser', 'Glycol lines from the chillers'],
      ['valveRoom', 'Main steam valve room'],
    ],
  },
];

/**
 * Pipe-break sequence timeline, in seconds of (compressed) sequence time.
 * STEP_STARTS[i] is when step i becomes the current one; STEP_SEEK[i] is where
 * choosing that step moves the playhead, a moment into it.
 */
export const STEP_STARTS = [0, 1.4, 2.8, 5.6, PERIOD];
export const STEP_SEEK = [0.3, 1.7, 3.6, 6.2, PERIOD + 0.6];
export const SEQUENCE_LENGTH = 12;

/** One or two sentences for every identifiable part, keyed as in plant.js PARTS. */
export const PART_INFO = {
  basemat: 'The reinforced concrete slab the whole building stands on. The containment vessel and the interior concrete are anchored to it.',
  shield: 'A reinforced concrete cylinder and dome, about a metre thick, around the steel vessel. It shields against radiation and protects the vessel from weather and impacts. The gap between the two is an annulus that can be held at slightly lower pressure so any leakage is collected and filtered.',
  vessel: 'A free-standing welded steel shell, on the order of an inch thick, that forms the leak-tight boundary. It is drawn thicker here so it can be seen. Because the ice absorbs most of the energy, it is designed for only about 12–15 psig.',
  spray: 'Ring headers under the dome with rows of nozzles. They spray cool water into the upper compartment to hold pressure and temperature down over the long term, after the ice has done its work.',
  craneWall: 'A thick concrete cylinder inside the vessel. It is the inner wall of the ice condenser, carries the polar crane on its top, and forms part of the divider barrier between the two compartments. The lower inlet doors are set into it.',
  divider: 'The operating deck. With the crane wall and the equipment enclosures it separates the lower compartment from the upper one, so steam from a break cannot bypass the ice.',
  cavity: 'The primary shield wall around the reactor vessel. Above it is the refuelling cavity, which is flooded during refuelling so fuel can be moved under water.',
  iceFloor: 'The concrete floor of the ice condenser with its wear slab, end walls and the support walls beneath. The floor is insulated and cooled, and drains through it lead back to the lower compartment.',
  reactor: 'The reactor pressure vessel, which holds the fuel. Coolant enters through the cold-leg nozzles, passes up through the core and leaves through the hot-leg nozzles to the steam generators.',
  crdm: 'Control rod drive mechanisms on the vessel head. They hold the control rods and step them in or out of the core; on a reactor trip the rods are released and drop in under gravity.',
  steamGen: 'One of four vertical U-tube steam generators. Hot reactor coolant flows inside thousands of tubes and boils clean water on the outside, making the steam that drives the turbine.',
  enclosure: 'Concrete enclosures around the upper parts of the steam generators and the pressurizer. They are part of the divider barrier, so a break in this equipment still vents into the lower compartment and through the ice.',
  rcp: 'A reactor coolant pump: a vertical pump with a large electric motor above it, one per loop, circulating coolant between the reactor and its steam generator.',
  rcsPipe: 'Reactor coolant piping. Each loop has a hot leg from the reactor to the steam generator, a crossover leg down to the pump, and a cold leg back to the reactor. A break here is the event the ice condenser is designed for.',
  pressurizer: 'The pressurizer holds the coolant system at pressure using electric heaters and a water spray, with a steam bubble in its upper half. A surge line connects it to one hot leg.',
  accumulator: 'A tank of borated water under nitrogen pressure, one per loop. If system pressure falls far enough, check valves open and it discharges into the cold leg on its own to help refill the reactor.',
  prt: 'The pressurizer relief tank. Steam from the pressurizer relief and safety valves is piped under water here and condensed.',
  airFan: 'One of two air return fans. They start some minutes after an accident signal and move air from the upper compartment back to the lower one, so it circulates through the ice again and hydrogen does not collect in pockets.',
  lowerSupport: 'The steel structure of columns and beams that carries the weight of the ice baskets above the lower plenum, leaving the space below open for incoming flow.',
  latticeFrame: 'Steel grids at intervals up the bed, with their support columns. They hold the basket columns in line and resist sideways loads while leaving flow passages between baskets.',
  wallPanel: 'Insulated panels lining the ice condenser. Chilled air circulates behind them so heat leaking in from the crane wall and the vessel is carried away before it reaches the ice.',
  vane: 'Curved turning vanes just inside the lower inlet doors. They turn the incoming flow from horizontal to vertical and spread it across the bottom of the bed.',
  ahu: 'An air handling unit in the upper plenum: fans and cooling coils fed with chilled glycol. Together the units keep the ice bed well below freezing.',
  glycol: 'Supply and return headers for the chilled glycol solution that cools the air handling units. The chillers themselves are outside the containment.',
  drain: 'A floor drain from the ice condenser to the lower compartment. Meltwater leaves this way and ends up in the containment sump.',
  basket: 'Ice baskets: perforated steel cylinders about 12 in across and 48 ft tall, filled with flake ice made from a borated solution. There are 81 in each of 24 bays, 1,944 in all; this model shows the 20 bays behind the cut.',
  lowerDoor: 'Lower inlet doors, in pairs, with their frame. Insulated and normally closed, they swing open on a very small pressure difference to let steam and air into the bottom of the ice bed.',
  midDeck: 'Intermediate deck doors and their beams. These light hinged panels lie across the top of the baskets and lift when flow comes up through the bed.',
  topDeck: 'The top deck: flexible insulated blanket panels over the upper plenum, with their beams. They lift to release air into the upper compartment and otherwise keep warm, moist air off the ice.',
  bridgeCrane: 'A small bridge crane on circular rails in the upper plenum. It is used during outages to reach, weigh and service the baskets and to load ice.',
  polarCrane: 'The polar crane, which rotates on a rail on top of the crane wall. It lifts the reactor vessel head and internals during refuelling and handles heavy equipment.',
  hatch: 'The equipment hatch: a large bolted opening through both shells for moving major components in and out during outages.',
  airlock: 'A personnel airlock with two interlocked doors, so people can enter and leave without opening the containment to the outside.',
  stack: 'The unit vent stack on the outside of the shield building, which discharges filtered ventilation air at height.',
  steamLine: 'A main steam line, carrying steam from the top of a steam generator out of the containment to the turbine. The routing here is simplified, and the two front lines stop at the cutaway.',
  igniter: 'A hydrogen igniter. These glow plugs, spread through the compartments and the ice condenser plenum, burn hydrogen deliberately at low concentration after a severe accident so it cannot accumulate.',
  sump: 'The containment sump, a screened pit in the lower compartment floor. Meltwater and spilled coolant collect here and are pumped back for long-term cooling and spray.',
  refuel: 'The refuelling machine: a bridge that travels over the flooded cavity and carries a mast for lifting fuel assemblies in and out of the reactor.',
  cableTray: 'Cable trays carrying power and instrument cables around the inside of the crane wall.',
  person: 'A figure 1.8 m (5 ft 11 in) tall, placed for scale. Nobody would be standing in these places with the plant running.',
  rwst: 'The refuelling water storage tank, a large outdoor tank of borated water. It feeds the emergency core cooling pumps and the containment sprays at first; when it runs low they switch to recirculating water from the sump.',
  chiller: 'Glycol chiller packages and the supply and return lines that carry chilled glycol up to the air handling units in the ice condenser. They are drawn outdoors here so they can be seen; the refrigeration plant is outside the containment in any case.',
  recombiner: 'An electric hydrogen recombiner. It heats the air passing through it so that hydrogen and oxygen combine into water, a slow way of removing hydrogen alongside the igniters. Many plants no longer rely on them.',
  valveRoom: 'A concrete room outside the containment where a main steam line emerges. It houses that line\'s isolation valve and safety valves, which vent through the stacks on its roof.',
  meltwater: 'Meltwater and condensed steam collecting on the lower compartment floor during the pipe-break sequence. It drains to the containment sump, from where it is pumped back for cooling and spray.',
};

/**
 * Layers that can be switched off to see inside. Each lists the parts (keys
 * from plant.js PARTS) it hides; a part belongs to at most one layer.
 */
export const LAYERS = [
  { id: 'shield', label: 'Shield building', parts: ['shield', 'stack', 'hatch', 'airlock'] },
  { id: 'vessel', label: 'Steel containment vessel', parts: ['vessel', 'spray'] },
  { id: 'concrete', label: 'Crane wall, decks and enclosures', parts: ['craneWall', 'divider', 'enclosure', 'cableTray', 'igniter'] },
  { id: 'baskets', label: 'Ice baskets', parts: ['basket'] },
  { id: 'iceStructure', label: 'Ice condenser structure', parts: ['latticeFrame', 'lowerSupport', 'wallPanel', 'vane', 'midDeck', 'topDeck', 'ahu', 'glycol', 'bridgeCrane', 'lowerDoor', 'drain'] },
  { id: 'crane', label: 'Polar crane', parts: ['polarCrane'] },
  { id: 'outdoor', label: 'Outdoor tank, chillers and valve rooms', parts: ['rwst', 'chiller', 'valveRoom'] },
];

export const NOTE = 'Representative model. Dimensions are approximate and thin steel is thickened for legibility.';
export { ANCHORS, DIM };
