/** Construction definitions and fixed simulation capacity tables. */
import type { TileKind, Tool, ToolDefinition } from '../domain/types';
import { tr } from '../i18n/index';

export type BilingualText = readonly [string, string];

const definition = (
  name: BilingualText,
  cost: number,
  upkeep: number,
  category: ToolDefinition['category'],
  color: string,
  icon: string,
  description: BilingualText,
  footprint?: [number, number],
): ToolDefinition => ({
  get name() {
    return tr(...name);
  },
  cost,
  upkeep,
  category,
  color,
  icon,
  get description() {
    return tr(...description);
  },
  ...(footprint ? { footprint } : {}),
});

export const TOOL_DEFS: Partial<Record<Tool, ToolDefinition>> = {
  residential: definition(['Wohngebiet', 'Residential zone'], 40, 0, 'zones', '#75b87c', 'House', [
    'Wohnraum wächst bei Straßen-, Wasser- und Stromanschluss des zusammenhängenden Blocks.',
    'Homes grow when connected to roads, a powered city block and water.',
  ]),
  commercial: definition(['Gewerbegebiet', 'Commercial zone'], 60, 0, 'zones', '#68a8dc', 'Store', [
    'Geschäfte, Büros und Arbeitsplätze. Benötigt Kunden und Versorgung.',
    'Shops, offices and jobs. Needs customers and utility connections.',
  ]),
  industrial: definition(
    ['Industriegebiet', 'Industrial zone'],
    70,
    0,
    'zones',
    '#d7b35c',
    'Factory',
    [
      'Fabriken, Lagerhallen und Werkstätten schaffen Jobs und Umweltbelastung.',
      'Factories, warehouses and workshops provide jobs and create pollution.',
    ],
  ),
  road: definition(['Straße', 'Road'], 18, 0.4, 'transport', '#899398', 'Route', [
    'Erschließt Grundstücke. Stromleitungen und Wasserrohre werden separat verlegt. Über Wasser entsteht eine Brücke.',
    'Provides access to lots. Power lines and water pipes are built separately. Becomes a bridge over water.',
  ]),
  rail: definition(['Bahnstrecke', 'Railway'], 35, 0.6, 'transport', '#a4abb0', 'TrainFront', [
    'Entlastet den Straßenverkehr im Umkreis. Brückenbau über Wasser möglich.',
    'Reduces nearby road traffic. Bridges can be built over water.',
  ]),
  pipe: definition(['Wasserrohr', 'Water pipe'], 8, 0.08, 'utilities', '#63bdd1', 'Droplets', [
    'Unterirdisches Leitungsnetz. Versorgt Grundstücke bis zwei Felder Abstand. Mit dem Wasserwerk verbinden.',
    'Underground network. Supplies lots within two tiles. Connect it to a waterworks.',
  ]),
  powerline: definition(['Stromleitung', 'Power line'], 12, 0.08, 'utilities', '#edbd67', 'Cable', [
    'Verbinde eine Kante jedes von Straßen umschlossenen Blocks. Im offenen Gelände müssen die Gebiete einander berühren. Große Anlagen erhalten sichtbare Anschlüsse ohne Straßenquerung. Verlegte Stromleitungen dürfen Straßen kreuzen.',
    'Connect one edge of each enclosed street block. In open terrain, zones must touch. Large facilities have visible service cables that never cross roads. Explicit power lines can cross roads.',
  ]),
  power: definition(
    ['Kraftwerk', 'Power plant'],
    6500,
    320,
    'utilities',
    '#edbd67',
    'Zap',
    [
      '4 × 4 Felder. Liefert 6.000 Stromeinheiten an angeschlossene Leitungen.',
      '4 × 4 tiles. Supplies 6,000 power units to connected lines.',
    ],
    [4, 4],
  ),
  waterpump: definition(
    ['Wasserwerk', 'Waterworks'],
    2200,
    180,
    'utilities',
    '#63bdd1',
    'Droplets',
    [
      '2 × 2 Felder. Mit Stromanschluss 6.000 Einheiten Wasser im eigenen Rohrnetz.',
      '2 × 2 tiles. Supplies 6,000 water units to its own pipe network when powered.',
    ],
    [2, 2],
  ),
  wind: definition(
    ['Windpark', 'Wind farm'],
    3600,
    65,
    'utilities',
    '#b6d2c3',
    'Wind',
    [
      '2 × 2 Felder. Sauberer Strom: 1.200 Einheiten ohne Luftbelastung.',
      '2 × 2 tiles. Clean power: 1,200 units without air pollution.',
    ],
    [2, 2],
  ),
  solar: definition(
    ['Solarpark', 'Solar farm'],
    6200,
    100,
    'utilities',
    '#84a9d1',
    'Sun',
    [
      '4 × 3 Felder. Saubere Energie mit Speichersystem: 3.200 Einheiten.',
      '4 × 3 tiles. Clean energy with storage: 3,200 units.',
    ],
    [4, 3],
  ),
  beach: definition(['Strand', 'Beach'], 300, 2, 'nature', '#d9c493', 'Umbrella', [
    'Strand mit Freizeitangebot direkt am Wasser. Verbessert die Lebensqualität.',
    'Shoreline beach with recreation. Improves quality of life.',
  ]),
  park: definition(['Stadtpark', 'City park'], 150, 5, 'nature', '#7faf71', 'Trees', [
    'Erhöht Grundstückswert und Lebensqualität in der Nachbarschaft.',
    'Increases local land values and quality of life.',
  ]),
  tree: definition(['Bäume', 'Trees'], 12, 0, 'nature', '#608765', 'TreePine', [
    'Begrünt freie Flächen und verbessert die lokale Luftqualität.',
    'Adds greenery to open land and improves local air quality.',
  ]),
  police: definition(
    ['Polizeiwache', 'Police station'],
    1900,
    125,
    'services',
    '#79a8c1',
    'Shield',
    [
      '2 × 2 Felder. Sicherheit im Umkreis, abhängig von Versorgung und Polizeibudget.',
      '2 × 2 tiles. Local safety depends on utilities and the police budget.',
    ],
    [2, 2],
  ),
  fire: definition(
    ['Feuerwache', 'Fire station'],
    1600,
    95,
    'services',
    '#d58569',
    'Flame',
    [
      '3 × 2 Felder. Versorgte Löschzüge verhindern Brandschäden in der Nachbarschaft.',
      '3 × 2 tiles. Supplied fire crews prevent fire damage in the neighborhood.',
    ],
    [3, 2],
  ),
  hospital: definition(
    ['Klinik', 'Hospital'],
    3200,
    150,
    'services',
    '#cf97a9',
    'HeartPulse',
    [
      '3 × 3 Felder. Gesundheitsversorgung für die umliegenden Stadtviertel.',
      '3 × 3 tiles. Healthcare for the surrounding districts.',
    ],
    [3, 3],
  ),
  school: definition(
    ['Schule', 'School'],
    1800,
    100,
    'services',
    '#bba5cf',
    'GraduationCap',
    [
      '3 × 2 Felder. Bildung fördert Wachstum und Zufriedenheit.',
      '3 × 2 tiles. Education promotes growth and happiness.',
    ],
    [3, 2],
  ),
  university: definition(
    ['Universität', 'University'],
    12000,
    280,
    'services',
    '#bba5cf',
    'BookOpen',
    [
      '5 × 4 Felder. Forschung, 160 Arbeitsplätze und höhere Bildung im weiten Umkreis.',
      '5 × 4 tiles. Research, 160 jobs and higher education over a wide area.',
    ],
    [5, 4],
  ),
  recycling: definition(
    ['Recyclinghof', 'Recycling center'],
    5200,
    110,
    'services',
    '#89b394',
    'Recycle',
    [
      '3 × 3 Felder. Reduziert die Umweltbelastung in einem großen Umkreis.',
      '3 × 3 tiles. Reduces pollution over a wide area.',
    ],
    [3, 3],
  ),
  stadium: definition(
    ['Stadion', 'Stadium'],
    9000,
    180,
    'special',
    '#b7c08a',
    'Trophy',
    [
      '6 × 5 Felder. Sportarena mit 120 Jobs und höherer Wohnraumnachfrage.',
      '6 × 5 tiles. Sports arena with 120 jobs and increased housing demand.',
    ],
    [6, 5],
  ),
  airport: definition(
    ['Flughafen', 'Airport'],
    16000,
    290,
    'special',
    '#abc2cf',
    'Plane',
    [
      '10 × 6 Felder. Terminal und Startbahn, 180 Jobs und höhere Gewerbenachfrage.',
      '10 × 6 tiles. Terminal and runway, 180 jobs and increased commercial demand.',
    ],
    [10, 6],
  ),
  seaport: definition(
    ['Hafen', 'Seaport'],
    9500,
    160,
    'special',
    '#81aeb8',
    'Ship',
    [
      '5 × 3 Felder. Kaimauer muss direkt ans Wasser grenzen. Mit R drehen. 120 Jobs und Industriebonus.',
      '5 × 3 tiles. The quay must directly border water. Rotate with R. 120 jobs and an industry bonus.',
    ],
    [5, 3],
  ),
  raise: definition(['Gelände anheben', 'Raise terrain'], 35, 0, 'terrain', '#adba88', 'Mountain', [
    'Hebt freies Gelände um 5 Meter an. Wasser lässt sich zu Bauland aufschütten.',
    'Raises open terrain by 5 meters. Water can be filled to create building land.',
  ]),
  lower: definition(
    ['Gelände absenken', 'Lower terrain'],
    35,
    0,
    'terrain',
    '#8aaab6',
    'ArrowDownToLine',
    [
      'Senkt freies Gelände um 5 Meter ab. Unter dem Meeresspiegel entsteht Wasser.',
      'Lowers open terrain by 5 meters. Creates water below sea level.',
    ],
  ),
  level: definition(
    ['Gelände einebnen', 'Level terrain'],
    35,
    0,
    'terrain',
    '#bcab85',
    'AlignVerticalDistributeCenter',
    [
      'Gleicht freies Gelände an die Höhe des zuerst angeklickten Felds an. 35 € je 5 Meter und Feld.',
      'Levels open terrain to the height of the first tile selected. €35 per 5 meters per tile.',
    ],
  ),
};

export const ZONES: TileKind[] = ['residential', 'commercial', 'industrial'];

export const KINDS: TileKind[] = [
  'empty',
  'water',
  'tree',
  'road',
  'rail',
  'residential',
  'commercial',
  'industrial',
  'power',
  'waterpump',
  'park',
  'beach',
  'police',
  'fire',
  'hospital',
  'school',
  'stadium',
  'airport',
  'seaport',
  'rubble',
  'wind',
  'solar',
  'university',
  'recycling',
];

export const POP = [0, 12, 28, 52, 88];

export const COM_JOBS = [0, 10, 26, 50, 88];

export const IND_JOBS = [0, 24, 48, 80, 112];
