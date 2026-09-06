import { tr } from '../i18n/index';
export const toolMetadata = (): Record<
  string,
  {
    icon: string;
    label: string;
  }
> => ({
  inspect: { icon: 'mouse-pointer-2', label: tr('Auswählen', 'Select') },
  road: { icon: 'route', label: tr('Straße', 'Road') },
  rail: { icon: 'train-front', label: tr('Schiene', 'Rail') },
  residential: { icon: 'house', label: tr('Wohnen', 'Residential') },
  commercial: { icon: 'building-2', label: tr('Gewerbe', 'Commercial') },
  industrial: { icon: 'factory', label: tr('Industrie', 'Industrial') },
  power: { icon: 'zap', label: tr('Kraftwerk', 'Power plant') },
  waterpump: { icon: 'droplets', label: tr('Wasserturm', 'Water tower') },
  beach: { icon: 'umbrella', label: tr('Strand', 'Beach') },
  park: { icon: 'trees', label: tr('Park', 'Park') },
  tree: { icon: 'tree-pine', label: tr('Bäume', 'Trees') },
  police: { icon: 'shield-check', label: tr('Polizei', 'Police') },
  fire: { icon: 'flame', label: tr('Feuerwehr', 'Fire station') },
  hospital: { icon: 'heart-pulse', label: tr('Klinik', 'Hospital') },
  school: { icon: 'graduation-cap', label: tr('Schule', 'School') },
  stadium: { icon: 'trophy', label: tr('Stadion', 'Stadium') },
  airport: { icon: 'plane', label: tr('Flughafen', 'Airport') },
  seaport: { icon: 'ship', label: tr('Hafen', 'Seaport') },
  bulldoze: { icon: 'pickaxe', label: tr('Abreißen', 'Demolish') },
  pan: { icon: 'hand', label: tr('Bewegen', 'Move') },
  citizen: { icon: 'person-standing', label: tr('Bewohner', 'Residents') },
  pipe: { icon: 'pipette', label: tr('Wasserrohre', 'Water pipes') },
  powerline: { icon: 'utility-pole', label: tr('Stromleitung', 'Power line') },
  raise: { icon: 'mountain', label: tr('Anheben', 'Raise') },
  lower: { icon: 'shovel', label: tr('Absenken', 'Lower') },
  level: { icon: 'align-vertical-justify-center', label: tr('Einebnen', 'Level') },
  wind: { icon: 'wind', label: tr('Windkraft', 'Wind farm') },
  solar: { icon: 'sun', label: tr('Solarpark', 'Solar farm') },
  university: { icon: 'graduation-cap', label: tr('Universität', 'University') },
  recycling: { icon: 'recycle', label: tr('Recycling', 'Recycling') },
});
