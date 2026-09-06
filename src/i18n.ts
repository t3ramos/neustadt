/** UI language is a browser preference, deliberately separate from a saved city. */
export type Locale = 'de' | 'en';

let locale:Locale = 'de';

export function getLocale():Locale { return locale; }
export function setLocale(value:Locale):void { locale=value==='en'?'en':'de'; }
export function localeCode():'de-DE'|'en-US' { return locale==='en'?'en-US':'de-DE'; }
export function tr(de:string,en:string):string { return locale==='en'?en:de; }

const numberFormats = new Map<string,Intl.NumberFormat>();
/** Match the game's existing integer rounding unless fractional digits are requested. */
export function formatNumber(value:number,maximumFractionDigits=0):string {
  const digits=Math.min(20,Math.max(0,Math.trunc(maximumFractionDigits)));
  const key=`${locale}:${digits}`;
  let formatter=numberFormats.get(key);
  if (!formatter) {
    formatter=new Intl.NumberFormat(localeCode(),{maximumFractionDigits:digits});
    numberFormats.set(key,formatter);
  }
  return formatter.format(digits===0?Math.round(value):value);
}

const currencies:Record<Locale,Intl.NumberFormat> = {
  de:new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:0}),
  en:new Intl.NumberFormat('en-US',{style:'currency',currency:'EUR',maximumFractionDigits:0}),
};
export function formatCurrency(value:number):string { return currencies[locale].format(Math.round(value)); }

/** Canonical German fields keep older save readers working; English fields travel with the save. */
export interface BilingualEventText { title:string; titleEn:string; message:string; messageEn:string; }
export interface LocalizableEvent { title:string; titleEn?:string; message:string; messageEn?:string; }
export function eventText(titleDE:string,titleEN:string,messageDE:string,messageEN:string):BilingualEventText {
  return {title:titleDE,titleEn:titleEN,message:messageDE,messageEn:messageEN};
}

const legacyTitles:Record<string,string> = Object.assign(Object.create(null),{
  'Ein neuer Anfang':'A new beginning',
  'Brandschäden':'Fire damage',
  'Eine Stadt wächst':'A growing city',
  'Jahresbericht':'Annual report',
  'Die Stadtkasse ist im Minus':'The city treasury is in the red',
  'Einwohner ziehen fort':'Residents are moving away',
  'Kredit ausgezahlt':'Loan paid out',
  'Keine Schäden':'No damage',
  'Brand in der Stadt':'Fire in the city',
  'Erdbeben':'Earthquake',
  'Überschwemmung':'Flood',
  'Schwerer Sturm':'Severe storm',
  'Neue Horizonte':'New horizons',
  'Belohnung erhalten':'Reward received',
  'Challenge gestartet':'Challenge started',
  'Challenge gemeistert':'Challenge completed',
  'Challenge beendet':'Challenge ended',
  'Stadtziel erreicht — deine Zukunftsstadt!':'City goal achieved — your city of tomorrow!',
  'Auftrag abgeschlossen':'Quest completed',
});

const legacyNames:Record<string,string> = Object.assign(Object.create(null),{
  'Siedlung':'Settlement','Dorf':'Village','Gemeinde':'Township','Kleinstadt':'Small Town',
  'Stadt':'City','Großstadt':'City','Metropole':'Metropolis','Weltstadt':'World city',
  'Megastadt':'Megacity','Weltmetropole':'Global metropolis',
  'Neue Verbindungen':'New Connections',
  'Raum zum Ankommen':'Room to Settle',
  'Das Land gestalten':'Shaping the Land',
  'Unter und über der Stadt':'Below and Above the City',
  'Eine verlässliche Stadt':'A Reliable City',
  'Arbeit vor Ort':'Local Jobs',
  'Eine Stadt atmet auf':'A City Breathes Again',
  'Gut versorgt':'In Good Hands',
  'Solide Finanzen':'Sound Finances',
  'Stadt des Wissens':'City of Knowledge',
  'Tor zum Meer':'Gateway to the Sea',
  'Saubere Zukunft':'A Clean Future',
  'Bereit zum Abheben':'Ready for Takeoff',
  'Die Stadt von morgen':'The City of Tomorrow',
  'Aufbruch in die Metropole':'Metropolitan Growth',
  'Grüne Hauptstadt':'Green Capital',
  'Goldene Stadtkasse':'Golden Treasury',
});

const legacyMessages:Record<string,string> = Object.assign(Object.create(null),{
  'Deine Stadt ist bereit. Neue Viertel, Forschung und Stadtaufträge warten auf dich. Straßen, Stromleitungen und Wasserrohre bilden eigene Netze.':'Your city is ready. New districts, research, and city quests await. Roads, power lines, and water pipes form separate networks.',
  'Deine Stadt ist bereit. Erschließe neue Wohngebiete, halte die Versorgung im Blick und baue eine Metropole.':'Your city is ready. Develop new residential districts, keep services running, and build a metropolis.',
  'Baue Straßen, Kraftwerk und Wasserwerk. Verbinde Stromleitungen und Wasserrohre mit den Anlagen und erschließe Wohn- und Arbeitsgebiete.':'Build roads, a power station, and a waterworks. Connect power lines and water pipes to the facilities, then develop residential and employment areas.',
  'Erhöhe Steuern, reduziere Ausgaben oder nimm einen Kredit auf.':'Raise taxes, reduce spending, or take out a loan.',
  'Prüfe Straßenanschluss, Stromleitungen, Wasserrohre und Arbeitsplätze.':'Check road access, power lines, water pipes, and jobs.',
  'Im betroffenen Gebiet stehen noch keine Gebäude.':'There are no buildings in the affected area yet.',
  'Ein neuer Kredit hat „Goldene Stadtkasse“ beendet. Du kannst die Challenge erneut versuchen.':'A new loan ended “Golden Treasury”. You can try the challenge again.',
});

const legacyDescriptions:Record<string,string> = Object.assign(Object.create(null),{
  'Baue eine gut versorgte Stadt mit Wohnvierteln, kleinen Betrieben und vollständiger Grundversorgung. Gebäude entwickeln sich bis Stufe 2.':'Build a well-served town with residential districts, small businesses, and all basic services. Buildings can develop to level 2.',
  'Bahn, Wind- und Solarenergie, Stadion, Hafen und Recycling werden verfügbar. Deine Stadt wächst mit dichterer Bebauung bis Gebäudestufe 3.':'Rail, wind and solar power, a stadium, a seaport, and recycling become available. Your city grows with denser development up to building level 3.',
  'Universität, Flughafen und die höchsten Wohn- und Geschäftshäuser prägen deine Metropole. Gebäude entwickeln sich bis Stufe 4.':'A university, an airport, and the tallest residential and commercial buildings shape your metropolis. Buildings can develop to level 4.',
  'Gewinne innerhalb von 60 Monaten 5.000 zusätzliche Einwohner gegenüber dem Start dieser Challenge.':'Gain 5,000 additional residents within 60 months of starting this challenge.',
  'Erreiche innerhalb von 120 Monaten 10.000 Einwohner bei einer Umweltbelastung unter 10.':'Reach 10,000 residents within 120 months while keeping pollution below 10.',
  'Steigere die Stadtkasse innerhalb von 60 Monaten um 150.000. Jeder neue Kredit beendet diese Challenge.':'Increase the city treasury by €150,000 within 60 months. Any new loan ends this challenge.',
});

// Old saves contain German-formatted numbers. Only numeric captures are parsed:
// city names such as "Bezirk 1.000" must stay untouched.
function oldNumber(value:string):string {
  const number=Number(value.replace(/[.\s\u00a0]/g,'').replace(',','.'));
  return new Intl.NumberFormat('en-US',{maximumFractionDigits:10}).format(number);
}
function translateLegacyTitle(title:string):string {
  if (legacyTitles[title]) return legacyTitles[title];
  const welcome=/^Willkommen in (.+)$/s.exec(title);
  if (welcome) return `Welcome to ${welcome[1]}`;
  const rank=/^Ausbaustufe erreicht: (.+)$/s.exec(title);
  if (rank&&legacyNames[rank[1]]) return `Development stage reached: ${legacyNames[rank[1]]}`;
  return `Original event: ${title}`;
}

/** Read-only compatibility for journal entries recorded before bilingual saves. */
function translateLegacyMessage(message:string):string {
  if (legacyMessages[message]) return legacyMessages[message];
  let match:RegExpExecArray|null;
  if ((match=/^([\d.,]+) Gebäude wurden zerstört\. Räume die Grundstücke und baue die Feuerwehr aus\.$/.exec(message)))
    return `${oldNumber(match[1])} buildings were destroyed. Clear the lots and expand fire protection.`;
  if ((match=/^([\d.,]+) Einwohner! Das Land fördert deine Stadt mit ([\d.,]+) €\.$/.exec(message)))
    return `${oldNumber(match[1])} residents! The state is supporting your city with €${oldNumber(match[2])}.`;
  if ((match=/^([\d.,]+) Einwohner · ([\d.,]+) % Zufriedenheit · ([+-]?[\d.,]+) € monatlich\.$/.exec(message)))
    return `${oldNumber(match[1])} residents · ${oldNumber(match[2])}% happiness · ${/^[+-]/.exec(match[3])?.[0]??''}€${oldNumber(match[3].replace(/^[+-]/,''))} per month.`;
  if ((match=/^([\d.,]+) € wurden ausgezahlt\. Monatlicher Zins: 0,5 %\.$/.exec(message)))
    return `€${oldNumber(match[1])} has been paid out. Monthly interest: 0.5%.`;
  if ((match=/^Ein Gebäude bei (-?\d+), (-?\d+) brennt\. Eine versorgte Feuerwache begrenzt die Schäden\.$/.exec(message)))
    return `A building at ${match[1]}, ${match[2]} is on fire. A fire station with working utilities limits the damage.`;
  if ((match=/^([\d.,]+) Gebäude beschädigt, ([\d.,]+) Leitungsfelder unterbrochen\. Räume Trümmer, repariere die Netze und stelle die Versorgung wieder her\.$/.exec(message)))
    return `${oldNumber(match[1])} buildings damaged, ${oldNumber(match[2])} utility tiles disconnected. Clear rubble, repair the networks, and restore services.`;
  if ((match=/^Das Stadtgebiet umfasst jetzt (\d+) × (\d+) Felder\. Bestehende Wohn- und Arbeitsgebiete wurden erhalten; öffentliche Gebäude haben eigene große Grundstücke\.$/.exec(message)))
    return `The city now covers ${oldNumber(match[1])} × ${oldNumber(match[2])} tiles. Existing residential and employment areas have been preserved; public buildings have their own large lots.`;
  if ((match=/^(.+): \+([\d.,]+) € und \+([\d.,]+) EP\.( Dein Abzeichen bleibt erhalten\.)?$/s.exec(message))&&legacyNames[match[1]])
    return `${legacyNames[match[1]]}: +€${oldNumber(match[2])} and +${oldNumber(match[3])} XP.${match[4]?' Your badge is permanent.':''}`;
  if ((match=/^(.+) gestartet\. Du hast (\d+) Monate\. (.+)$/s.exec(message))&&legacyNames[match[1]]&&legacyDescriptions[match[3]])
    return `${legacyNames[match[1]]} started. You have ${oldNumber(match[2])} months. ${legacyDescriptions[match[3]]}`;
  if ((match=/^(.+): Die Zeit ist abgelaufen\. Du kannst es erneut versuchen\.$/s.exec(message))&&legacyNames[match[1]])
    return `${legacyNames[match[1]]}: Time has run out. You can try again.`;
  if ((match=/^([\d.,]+) Einwohner erreicht\. (.+)$/s.exec(message))&&legacyDescriptions[match[2]])
    return `${oldNumber(match[1])} residents reached. ${legacyDescriptions[match[2]]}`;
  if ((match=/^(.+) hat sechs Monate lang mindestens 25\.000 Einwohner, hohe Lebensqualität und einen positiven Haushalt gehalten\. Du hast die Kampagne gemeistert\. Baue im freien Spiel weiter!$/s.exec(message)))
    return `${match[1]} maintained at least 25,000 residents, a high quality of life, and a positive budget for six months. You completed the campaign. Keep building in free play!`;
  if ((match=/^(.+) — hole ([\d.,]+) € und ([\d.,]+) EP im Stadtziel-Fenster ab\.$/s.exec(message))&&legacyNames[match[1]])
    return `${legacyNames[match[1]]} — collect €${oldNumber(match[2])} and ${oldNumber(match[3])} XP in the city goals window.`;
  // Unknown imported text can be user-authored. Keep its meaning and data intact;
  // the title labels these entries as original text instead of inventing a translation.
  return message;
}

export function localizedEventTitle(event:Pick<LocalizableEvent,'title'|'titleEn'>):string {
  return locale==='de'?event.title:event.titleEn||translateLegacyTitle(event.title);
}
export function localizedEventMessage(event:Pick<LocalizableEvent,'message'|'messageEn'>):string {
  return locale==='de'?event.message:event.messageEn||translateLegacyMessage(event.message);
}
