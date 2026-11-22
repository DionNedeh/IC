// Tour copy, camera stops, callouts, part descriptions and the source list.
// Figures are taken from the public documents in SOURCES. They vary by unit and
// by licence amendment, so treat them as approximate. Angles are degrees,
// distances metres.

import { ANCHORS, DIM } from './plant.js';
import { polar, DEG } from './math.js';
import { PERIOD } from './flow.js';

/**
 * Public documents the text draws on. `short` is the label used on the tour
 * card; `note` says what the document was used for. README.md lists the same
 * links, and a test fails if the two drift apart.
 */
export const SOURCES = [
  {
    id: 'cook-ufsar',
    short: 'Cook UFSAR ch. 5',
    title: 'D.C. Cook Updated Final Safety Analysis Report, Chapter 5, "Containment System" (Rev. 30)',
    publisher: 'Indiana Michigan Power, in NRC ADAMS, ML21125A562',
    url: 'https://www.nrc.gov/docs/ML2112/ML21125A562.pdf',
    note: 'Ice bed, doors, decks, refrigeration, divider barrier; the steel-lined concrete containment; 12 psig design pressure.',
  },
  {
    id: 'mcguire-ufsar',
    short: 'McGuire UFSAR ch. 6',
    title: 'McGuire Updated Final Safety Analysis Report, Chapter 6, "Engineered Safety Features" (2020)',
    publisher: 'Duke Energy, in NRC ADAMS, ML20309A729',
    url: 'https://www.nrc.gov/docs/ML2030/ML20309A729.pdf',
    note: 'Baskets, lattice frames, lower inlet doors, turning vanes, deck doors, air handling units and glycol loop; 15 psig; free volume; fan delay.',
  },
  {
    id: 'catawba-ufsar',
    short: 'Catawba UFSAR ch. 6',
    title: 'Catawba Updated Final Safety Analysis Report, Chapter 6 (2018)',
    publisher: 'Duke Energy, in NRC ADAMS, ML18305A298',
    url: 'https://www.nrc.gov/docs/ML1830/ML18305A298.pdf',
    note: 'Section 6.7 describes the ice condenser; 15 psig design pressure; free volume; fan delay.',
  },
  {
    id: 'sts-ice',
    short: 'Standard Tech Specs (ice bed)',
    title: 'TSTF-336 Rev. 1, reproducing the NUREG-1431 Standard Technical Specifications and Bases for the ice bed and its doors',
    publisher: 'Technical Specifications Task Force, in NRC ADAMS, ML003735321',
    url: 'https://www.nrc.gov/docs/ML0037/ML003735321.pdf',
    note: '1,944 baskets, 24 bays, 300° arc, 27 °F limit, boron and pH, sublimation and frost, flow channel checks, door opening order.',
  },
  {
    id: 'wbn2-ts',
    short: 'Watts Bar 2 Tech Specs',
    title: 'Watts Bar Unit 2 Technical Specifications (developmental revision, 2013)',
    publisher: 'Tennessee Valley Authority, in NRC ADAMS, ML13357A053',
    url: 'https://www.nrc.gov/docs/ML1335/ML13357A053.pdf',
    note: 'Minimum ice mass, 27 °F limit, air return fan delay of 8 to 10 minutes.',
  },
  {
    id: 'mcguire-ice-ts',
    short: 'McGuire ice bed Tech Spec',
    title: 'McGuire Technical Specification 3.6.12, "Ice Bed", and Bases (Amendments 217/199)',
    publisher: 'NRC ADAMS, ML032760444',
    url: 'https://www.nrc.gov/docs/ML0327/ML032760444.pdf',
    note: 'Minimum ice mass of 1,890,000 lb, the lowest of the plants checked.',
  },
  {
    id: 'cook-bases',
    short: 'Cook Tech Spec Bases',
    title: 'D.C. Cook Unit 1 Technical Specifications Bases',
    publisher: 'Indiana Michigan Power, in NRC ADAMS, ML16355A102',
    url: 'https://www.nrc.gov/docs/ML1635/ML16355A102.pdf',
    note: 'Minimum ice mass; recirculation fans that start after 270 to 300 seconds.',
  },
  {
    id: 'sequoyah-its',
    short: 'Sequoyah Tech Spec conversion',
    title: 'Sequoyah Improved Technical Specifications Conversion, Enclosure 2, Volume 11 (Section 3.6, Containment Systems)',
    publisher: 'Tennessee Valley Authority, in NRC ADAMS, ML13330A931',
    url: 'https://www.nrc.gov/docs/ML1333/ML13330A931.pdf',
    note: 'Ice bed limits, air return fan delay, and the emergency gas treatment system that holds the annulus below atmospheric pressure.',
  },
  {
    id: 'sequoyah-ser',
    short: 'Sequoyah SER (NUREG-0011)',
    title: 'NUREG-0011 Supplement 3, Safety Evaluation Report for Sequoyah Nuclear Plant (1980)',
    publisher: 'U.S. Nuclear Regulatory Commission, hosted by OSTI',
    url: 'https://www.osti.gov/etdeweb/servlets/purl/20472055',
    note: 'Sequoyah design pressure of 10.8 psig and its free volume.',
  },
  {
    id: 'nureg-1150',
    short: 'NUREG-1150 app. C',
    title: 'NUREG-1150, "Severe Accident Risks: An Assessment for Five U.S. Nuclear Power Plants", Volume 2, Appendix C',
    publisher: 'U.S. Nuclear Regulatory Commission, 1990',
    url: 'https://www.nrc.gov/reading-rm/doc-collections/nuregs/staff/sr1150/v2/sr1150v2appc.pdf',
    note: 'Side-by-side free volume and design pressure for Sequoyah (ice condenser), Zion and Surry (dry); hydrogen after Three Mile Island.',
  },
  {
    id: 'sandia-overview',
    short: 'Sandia containment overview',
    title: 'NUREG/CR-6906, "Containment Integrity Research at Sandia National Laboratories: An Overview"',
    publisher: 'Sandia National Laboratories for the U.S. NRC, 2006',
    url: 'https://www.sandia.gov/app/uploads/sites/172/2022/03/NUREG_CR-6906-ContSum.pdf',
    note: 'A short, readable account of the containment types, with a figure of an ice condenser containment.',
  },
  {
    id: 'vessel-notice',
    short: 'NRC Information Notice 89-79',
    title: 'NRC Information Notice 89-79, "Degraded Coatings and Corrosion of Steel Containment Vessels"',
    publisher: 'U.S. Nuclear Regulatory Commission, in ADAMS, ML031190084',
    url: 'https://www.nrc.gov/docs/ML0311/ML031190084.pdf',
    note: 'Steel shell about one inch thick and a six-foot annulus at McGuire and Catawba.',
  },
  {
    id: 'b-54',
    short: 'NUREG-0933 item B-54',
    title: 'NUREG-0933, Item B-54, "Ice Condenser Containments"',
    publisher: 'U.S. Nuclear Regulatory Commission',
    url: 'https://www.nrc.gov/sr0933/section-2-task-action-plan-items/item-b-54-ice-condenser-containments',
    note: 'The regulator\'s own short summary of the design.',
  },
  {
    id: 'issue-189',
    short: 'NUREG-0933 issue 189',
    title: 'NUREG-0933, Issue 189, susceptibility of ice condenser and Mark III containments to early failure from hydrogen combustion',
    publisher: 'U.S. Nuclear Regulatory Commission',
    url: 'https://www.nrc.gov/sr0933/section-3-new-generic-issues/issue-189-susceptibility-ice-condenser-containments-early-failure-hydogen-combustion-during-severe',
    note: 'Why a small, low-pressure containment is more exposed to hydrogen burns.',
  },
  {
    id: 'mcguire-bases',
    short: 'McGuire Tech Spec Bases',
    title: 'McGuire Technical Specification Bases, including B 3.6.9 "Hydrogen Mitigation System" and B 3.6.16 "Reactor Building"',
    publisher: 'Duke Energy, in NRC ADAMS, ML14142A011',
    url: 'https://www.nrc.gov/docs/ML1414/ML14142A011.pdf',
    note: 'Thermal igniters and why ice condenser units need them; the annulus ventilation system.',
  },
  {
    id: 'rule-2003',
    short: '2003 hydrogen rule',
    title: '"Combustible Gas Control in Containment", final rule, 68 FR 54123 (16 September 2003)',
    publisher: 'U.S. Nuclear Regulatory Commission, via GovInfo',
    url: 'https://www.govinfo.gov/content/pkg/FR-2003-09-16/html/03-23554.htm',
    note: 'Removed the requirement for hydrogen recombiners; kept hydrogen control for ice condenser and Mark III containments.',
  },
  {
    id: 'cfr-50-44',
    short: '10 CFR 50.44',
    title: '10 CFR 50.44, "Combustible gas control for nuclear power reactors"',
    publisher: 'Code of Federal Regulations, via Cornell Legal Information Institute',
    url: 'https://www.law.cornell.edu/cfr/text/10/50.44',
    note: 'The rule as it stands.',
  },
  {
    id: 'wtsm-rcs',
    short: 'NRC systems manual 3.2',
    title: 'Westinghouse Technology Systems Manual, Section 3.2, "Reactor Coolant System"',
    publisher: 'U.S. NRC Technical Training Center, in ADAMS, ML11223A213',
    url: 'https://www.nrc.gov/docs/ML1122/ML11223A213.pdf',
    note: 'Loop layout, steam generators, pumps, pressurizer, surge line and relief tank.',
  },
  {
    id: 'catawba-table',
    short: 'Catawba UFSAR table 4-1',
    title: 'Catawba Updated Final Safety Analysis Report, Appendix 4A, Table 4-1, "Reactor Design Comparison Table"',
    publisher: 'Duke Energy, in NRC ADAMS, ML18305A292',
    url: 'https://www.nrc.gov/docs/ML1830/ML18305A292.pdf',
    note: '3,411 MW thermal, 2,250 psia, 554.7 °F inlet and a 62.5 °F rise through the vessel.',
  },
  {
    id: 'wtsm-eccs',
    short: 'NRC systems manual 5.2',
    title: 'Westinghouse Technology Systems Manual, Section 5.2, "Emergency Core Cooling Systems"',
    publisher: 'U.S. NRC Technical Training Center, in ADAMS, ML11223A220',
    url: 'https://www.nrc.gov/docs/ML1122/ML11223A220.pdf',
    note: 'Accumulators, the refuelling water storage tank, and the switch to recirculation from the sump.',
  },
  {
    id: 'wtsm-containment',
    short: 'NRC systems manual 5.3',
    title: 'Westinghouse Technology Systems Manual, Section 5.3, "Containment"',
    publisher: 'U.S. NRC Technical Training Center, in ADAMS, ML11223A221',
    url: 'https://www.nrc.gov/docs/ML1122/ML11223A221.pdf',
    note: 'The large dry containment used for comparison: about 2 million ft³ and 60 psig.',
  },
  {
    id: 'wtsm-spray',
    short: 'NRC systems manual 5.4',
    title: 'Westinghouse Technology Systems Manual, Section 5.4, "Containment Temperature, Pressure and Combustible Gas Control Systems"',
    publisher: 'U.S. NRC Technical Training Center, in ADAMS, ML11223A222',
    url: 'https://www.nrc.gov/docs/ML1122/ML11223A222.pdf',
    note: 'Containment spray, from the storage tank and then from the sump.',
  },
  {
    id: 'wtsm',
    short: 'NRC systems manual (all)',
    title: 'Westinghouse Technology Systems Manual, index of all chapters',
    publisher: 'U.S. NRC Technical Training Center, in ADAMS, ML11221A368',
    url: 'https://www.nrc.gov/docs/ML1122/ML11221A368.html',
    note: 'Sections 3.1 (reactor vessel, control rod drop) and 17.1 (fuel handling, the flooded refuelling cavity) were also used.',
  },
  {
    id: 'pwr-primer',
    short: 'NRC PWR primer',
    title: 'Reactor Concepts Manual, "Pressurized Water Reactor (PWR) Systems"',
    publisher: 'U.S. NRC Technical Training Center',
    url: 'https://www.nrc.gov/reading-rm/basic-ref/students/for-educators/04.pdf',
    note: 'The most readable starting point for how a pressurized-water reactor works.',
  },
  {
    id: 'nrc-units',
    short: 'NRC reactor list',
    title: 'List of Power Reactor Units',
    publisher: 'U.S. Nuclear Regulatory Commission',
    url: 'https://www.nrc.gov/reactors/operating/list-power-reactor-units.html',
    note: 'The ten operating U.S. units; each unit\'s page gives its containment type as "Wet, Ice condenser".',
  },
  {
    id: 'loviisa',
    short: 'Fortum: Loviisa',
    title: 'Loviisa power plant history',
    publisher: 'Fortum',
    url: 'https://www.fortum.com/energy-production/nuclear-power/plants/loviisa/history',
    note: 'Two VVER-440 units whose steel containment and ice condensers were built under Westinghouse licences.',
  },
  {
    id: 'ohi',
    short: 'World Nuclear News: Ohi',
    title: '"Kansai opts to retire older Ohi units"',
    publisher: 'World Nuclear News, 22 December 2017',
    url: 'https://world-nuclear-news.org/articles/kansai-opts-to-retire-older-ohi-units',
    note: 'Japan\'s only ice condenser reactors, and the decision to retire them. News reporting, not a primary document.',
  },
];

export const STOPS = [
  {
    id: 'overview',
    title: 'Ice condenser containment',
    body: [
      'A pressurized-water reactor building that wraps the reactor in a 300° ring of borated ice. If a coolant pipe breaks, the steam can only reach the upper building by passing through that ice, and most of it condenses on the way.',
      'Absorbing the energy this way lets the structure be roughly half to two-thirds the volume, and about a quarter of the design pressure, of a conventional large dry containment.',
      'Click or tap any part of the model to identify it, or open Layers to peel the building apart and find a part by name.',
    ],
    figures: [['1,944', 'ice baskets'], ['24', 'bays over ≈300°'], ['≈ 1.9–2.5 million lb', 'of ice required, by plant']],
    sources: ['sts-ice', 'nureg-1150', 'b-54', 'sandia-overview'],
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
      'A divider barrier splits the building in two. The lower compartment holds the reactor coolant system; the upper compartment is a large, empty expansion volume. The barrier is the operating deck, the crane wall, the walls of the refuelling canal, and the enclosures that box in the tops of the steam generators and the pressurizer.',
      'The only significant path between the two is the ice condenser. Steam released below has to push through the ice to get above, which is the whole idea of the design.',
    ],
    figures: [['2', 'compartments'], ['3', 'sets of doors in the path']],
    sources: ['cook-ufsar', 'mcguire-ufsar', 'sts-ice'],
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
    figures: [['4', 'coolant loops'], ['≈ 15.5 MPa', 'operating pressure'], ['≈ 3,400 MW', 'thermal, as designed']],
    sources: ['wtsm-rcs', 'catawba-table', 'pwr-primer'],
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
      'Each bay holds 81 columns of perforated steel baskets, roughly 12 in (0.3 m) across and 48 ft (14.6 m) tall, packed with flake ice frozen from a sodium tetraborate solution. Lattice frames every six feet keep the columns aligned and leave flow passages between them.',
      'The perforations expose a very large ice surface to passing steam. The borate keeps the meltwater borated for cooling the core, and alkaline, which helps hold radioactive iodine in the sump water.',
    ],
    figures: [['81', 'baskets per bay'], ['48 ft', 'basket height'], ['≤ 27 °F', 'bed temperature limit']],
    sources: ['mcguire-ufsar', 'cook-ufsar', 'sts-ice'],
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
    sources: ['mcguire-ufsar', 'catawba-ufsar', 'cook-ufsar'],
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
    figures: [['≈ 10–20 °F', 'typical bed temperature'], ['Glycol', 'chilled coolant loop']],
    sources: ['mcguire-ufsar', 'cook-ufsar', 'sts-ice'],
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
      'Meltwater drains to the sump. After a delay of about five to ten minutes, depending on the plant, air return fans push upper-compartment air back down through the ice.',
    ],
    sequence: true,
    sources: ['sts-ice', 'mcguire-ufsar', 'cook-bases'],
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
      'Air return fans start after a delay and push upper-compartment air back down so it passes through the ice again. Hydrogen igniters, added after the Three Mile Island accident, burn off hydrogen in small amounts before it can build up in the smaller building.',
      'Show the sprays and the air return path to watch both at work. Like the pipe-break sequence, this is a schematic, not a simulation.',
    ],
    cooling: true,
    figures: [['≈ 5–10 min', 'fan start delay, by plant'], ['2', 'air return fans']],
    sources: ['wtsm-spray', 'wtsm-eccs', 'wbn2-ts', 'mcguire-bases'],
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
      'Design pressure is about 11–15 psig (10.8 at Sequoyah, 15 at McGuire and Catawba), against roughly 45–60 psig for a large dry containment, inside a free volume of about 1.2 million ft³. The price is upkeep: refrigeration, ice weighing and door testing for the life of the plant.',
      'A smaller building also concentrates hydrogen sooner in a severe accident, which is why the igniters were added. Ten U.S. units at five sites use the design (D.C. Cook, Sequoyah, McGuire, Catawba, Watts Bar), as do Loviisa in Finland and Ohi 1 and 2 in Japan, which were retired in 2018.',
    ],
    figures: [['≈ 11–15 psig', 'design pressure'], ['10', 'U.S. units, 5 sites']],
    sources: ['nureg-1150', 'sequoyah-ser', 'issue-189', 'nrc-units', 'loviisa', 'ohi'],
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
  shield: 'A reinforced concrete cylinder and dome around the steel vessel. It shields against radiation and protects the vessel from weather and impacts. After an accident, fans draw the annulus between the two to slightly below atmospheric pressure and exhaust it through filters, so leakage is collected. D.C. Cook is built differently: a single steel-lined concrete containment with no separate shell or annulus.',
  vessel: 'A free-standing welded steel shell, on the order of an inch thick, that forms the leak-tight boundary. It is drawn thicker here so it can be seen. Because the ice absorbs most of the energy, it is designed for only about 11–15 psig.',
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
  rcsPipe: 'Reactor coolant piping. Each loop has a hot leg from the reactor to the steam generator, a crossover (or intermediate) leg down to the pump, and a cold leg back to the reactor. A break here is the event the ice condenser is designed for.',
  pressurizer: 'The pressurizer holds the coolant system at pressure using electric heaters and a water spray, with a steam bubble in its upper half. A surge line connects it to one hot leg.',
  accumulator: 'A tank of borated water under nitrogen pressure, one per loop. If system pressure falls far enough, check valves open and it discharges into the cold leg on its own to help refill the reactor.',
  prt: 'The pressurizer relief tank. Steam from the pressurizer relief and safety valves is piped under water here and condensed.',
  airFan: 'One of two air return fans. They start some minutes after an accident signal (about nine or ten at most plants, about five at D.C. Cook) and move air from the upper compartment back to the lower one, so it circulates through the ice again and hydrogen does not collect in pockets.',
  lowerSupport: 'The steel structure of columns and beams that carries the weight of the ice baskets above the lower plenum, leaving the space below open for incoming flow.',
  latticeFrame: 'Steel grids at six-foot intervals up the bed, with their support columns. They hold the basket columns in line and resist sideways loads while leaving flow passages between baskets.',
  wallPanel: 'Insulated panels lining the ice condenser. Chilled air circulates behind them so heat leaking in from the crane wall and the vessel is carried away before it reaches the ice.',
  vane: 'Curved turning vanes just inside the lower inlet doors, part of the lower support structure. They turn the incoming flow from horizontal to vertical and spread it across the bottom of the bed.',
  ahu: 'An air handling unit in the upper plenum: fans and cooling coils fed with chilled glycol. Together the units, about thirty to a containment, keep the ice bed well below freezing.',
  glycol: 'Supply and return headers for the chilled glycol solution that cools the air handling units. The chillers themselves are outside the containment.',
  drain: 'A floor drain from the ice condenser to the lower compartment. Meltwater leaves this way and ends up in the containment sump.',
  basket: 'Ice baskets: perforated steel cylinders about 12 in across, coupled end to end into columns 48 ft tall and filled with flake ice made from a borated solution. There are 81 columns in each of 24 bays, 1,944 in all; this model shows the 20 bays behind the cut.',
  lowerDoor: 'Lower inlet doors, in pairs, with their frame. Insulated and normally closed, they swing open on a very small pressure difference to let steam and air into the bottom of the ice bed.',
  midDeck: 'Intermediate deck doors and their beams. These light hinged panels lie across the top of the baskets and lift when flow comes up through the bed.',
  topDeck: 'The top deck: flexible insulated blanket panels over the upper plenum, with their beams. They lift to release air into the upper compartment and otherwise keep warm, moist air off the ice.',
  bridgeCrane: 'A small bridge crane on circular rails in the upper plenum. It is used during outages to reach, weigh and service the baskets and to load ice. Arrangements differ between plants; at D.C. Cook the crane is now kept outside the ice condenser.',
  polarCrane: 'The polar crane, which rotates on a rail on top of the crane wall. It lifts the reactor vessel head and internals during refuelling and handles heavy equipment.',
  hatch: 'The equipment hatch: a large bolted opening through both shells for moving major components in and out during outages.',
  airlock: 'A personnel airlock with two interlocked doors, so people can enter and leave without opening the containment to the outside.',
  stack: 'The unit vent stack on the outside of the shield building, which discharges filtered ventilation air at height.',
  steamLine: 'A main steam line, carrying steam from the top of a steam generator out of the containment to the turbine. The routing here is simplified, and the two front lines stop at the cutaway.',
  igniter: 'A hydrogen igniter. These thermal igniters, hot enough to light hydrogen on contact and spread through the compartments and the ice condenser plenum, burn it deliberately at low concentration after a severe accident so it cannot accumulate.',
  sump: 'The containment sump, a screened pit in the lower compartment floor. Meltwater and spilled coolant collect here and are pumped back for long-term cooling and spray.',
  refuel: 'The refuelling machine: a bridge that travels over the flooded cavity and carries a mast for lifting fuel assemblies in and out of the reactor.',
  cableTray: 'Cable trays carrying power and instrument cables around the inside of the crane wall.',
  person: 'A figure 1.8 m (5 ft 11 in) tall, placed for scale. Nobody would be standing in these places with the plant running.',
  rwst: 'The refuelling water storage tank, a large outdoor tank of borated water. It feeds the emergency core cooling pumps and the containment sprays at first; when it runs low they switch to recirculating water from the sump.',
  chiller: 'Glycol chiller packages and the supply and return lines that carry chilled glycol up to the air handling units in the ice condenser. They are drawn outdoors here so they can be seen; the refrigeration plant is outside the containment in any case.',
  recombiner: 'An electric hydrogen recombiner. It heats the air passing through it so that hydrogen and oxygen combine into water, a slow way of removing hydrogen alongside the igniters. A 2003 rule change removed the requirement to have them.',
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

export const NOTE = 'For fun and education only, not an authoritative source. Representative model: dimensions are approximate and thin steel is thickened for legibility.';

/**
 * Shown on a card every time the page is opened, and at the top of the Sources
 * panel. README.md carries the same advisory.
 */
export const ADVISORY = 'This cutaway is for fun and for education only. It is not an established or authoritative information source, and it must not be used for engineering, safety, operational or regulatory purposes. Every effort has been made to keep it accurate and to trace its figures to the public documents listed under Sources, but it is a simplified, representative model of no specific plant, the figures vary from unit to unit, and it may contain mistakes. Where accuracy matters, go to the sources.';

export { ANCHORS, DIM };
