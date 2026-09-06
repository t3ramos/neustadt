import assert from 'node:assert/strict';
import test,{afterEach} from 'node:test';
import {
  eventText,formatCurrency,formatNumber,getLocale,localeCode,
  localizedEventMessage,localizedEventTitle,setLocale,tr,
} from '../src/i18n.ts';

afterEach(()=>setLocale('de'));

test('language starts in German and can switch at runtime without browser globals',()=>{
  assert.equal(getLocale(),'de');
  assert.equal(localeCode(),'de-DE');
  assert.equal(tr('Straße','Road'),'Straße');
  setLocale('en');
  assert.equal(getLocale(),'en');
  assert.equal(localeCode(),'en-US');
  assert.equal(tr('Straße','Road'),'Road');
  setLocale('de');
  assert.equal(tr('Straße','Road'),'Straße');
});

test('number and currency formatting follows the UI language and existing integer rounding',()=>{
  assert.equal(formatNumber(1234567.6),'1.234.568');
  assert.equal(formatNumber(-1.5),'-1');
  assert.equal(formatNumber(1234.56,1),'1.234,6');
  assert.match(formatCurrency(1234.6),/^1\.235\s€$/);
  setLocale('en');
  assert.equal(formatNumber(1234567.6),'1,234,568');
  assert.equal(formatNumber(-1.5),'-1');
  assert.equal(formatNumber(1234.56,1),'1,234.6');
  assert.equal(formatCurrency(1234.6),'€1,235');
  assert.equal(formatCurrency(-1234.6),'-€1,235');
});

test('new event translations survive serialization and language switches without mutating a save',()=>{
  const stored=eventText('Eine Stadt wächst','A growing city','2.500 Einwohner!','2,500 residents!');
  const before=JSON.stringify(stored);
  const event=JSON.parse(before);
  assert.equal(localizedEventTitle(event),'Eine Stadt wächst');
  assert.equal(localizedEventMessage(event),'2.500 Einwohner!');
  setLocale('en');
  assert.equal(localizedEventTitle(event),'A growing city');
  assert.equal(localizedEventMessage(event),'2,500 residents!');
  setLocale('de');
  assert.equal(localizedEventMessage(event),'2.500 Einwohner!');
  assert.equal(JSON.stringify(event),before);
});

test('legacy annual reports retain signs and decimal money while changing numeric separators',()=>{
  const event={title:'Jahresbericht',message:'12.345 Einwohner · 83 % Zufriedenheit · +1.234,56 € monatlich.'};
  setLocale('en');
  assert.equal(localizedEventTitle(event),'Annual report');
  assert.equal(localizedEventMessage(event),'12,345 residents · 83% happiness · +€1,234.56 per month.');
  event.message='12.345 Einwohner · 83 % Zufriedenheit · -1.234,56 € monatlich.';
  assert.equal(localizedEventMessage(event),'12,345 residents · 83% happiness · -€1,234.56 per month.');
});

test('legacy welcome and victory translations preserve user city names exactly',()=>{
  const name='Großstadt Bezirk 1.000 & Lindenbucht';
  const welcome={title:`Willkommen in ${name}`,message:'Deine Stadt ist bereit. Erschließe neue Wohngebiete, halte die Versorgung im Blick und baue eine Metropole.'};
  const victory={message:`${name} hat sechs Monate lang mindestens 25.000 Einwohner, hohe Lebensqualität und einen positiven Haushalt gehalten. Du hast die Kampagne gemeistert. Baue im freien Spiel weiter!`};
  setLocale('en');
  assert.equal(localizedEventTitle(welcome),`Welcome to ${name}`);
  assert.equal(localizedEventMessage(welcome),'Your city is ready. Develop new residential districts, keep services running, and build a metropolis.');
  assert.ok(localizedEventMessage(victory).startsWith(`${name} maintained at least 25,000 residents`));
  assert.equal(welcome.title,`Willkommen in ${name}`);
});

test('every current legacy title has English text including all development stages',()=>{
  const titles=[
    'Willkommen in Lindenbucht','Ein neuer Anfang','Brandschäden','Eine Stadt wächst','Jahresbericht',
    'Die Stadtkasse ist im Minus','Einwohner ziehen fort','Kredit ausgezahlt','Keine Schäden',
    'Brand in der Stadt','Erdbeben','Überschwemmung','Schwerer Sturm','Neue Horizonte',
    'Belohnung erhalten','Challenge gestartet','Challenge gemeistert','Challenge beendet',
    'Stadtziel erreicht — deine Zukunftsstadt!','Auftrag abgeschlossen',
    'Ausbaustufe erreicht: Kleinstadt','Ausbaustufe erreicht: Großstadt','Ausbaustufe erreicht: Metropole',
  ];
  setLocale('en');
  for (const title of titles) {
    const translated=localizedEventTitle({title});
    assert.ok(!translated.startsWith('Original event:'),title);
    assert.notEqual(translated,title,title);
  }
  assert.equal(localizedEventTitle({title:'Ausbaustufe erreicht: Kleinstadt'}),'Development stage reached: Small Town');
});

test('legacy simulation journals translate every static and dynamic event family',()=>{
  const messages=[
    'Deine Stadt ist bereit. Neue Viertel, Forschung und Stadtaufträge warten auf dich. Straßen, Stromleitungen und Wasserrohre bilden eigene Netze.',
    'Baue Straßen, Kraftwerk und Wasserwerk. Verbinde Stromleitungen und Wasserrohre mit den Anlagen und erschließe Wohn- und Arbeitsgebiete.',
    '12 Gebäude wurden zerstört. Räume die Grundstücke und baue die Feuerwehr aus.',
    '2.500 Einwohner! Das Land fördert deine Stadt mit 5.000 €.',
    'Erhöhe Steuern, reduziere Ausgaben oder nimm einen Kredit auf.',
    'Prüfe Straßenanschluss, Stromleitungen, Wasserrohre und Arbeitsplätze.',
    '10.000 € wurden ausgezahlt. Monatlicher Zins: 0,5 %.',
    'Im betroffenen Gebiet stehen noch keine Gebäude.',
    'Ein Gebäude bei 30, 45 brennt. Eine versorgte Feuerwache begrenzt die Schäden.',
    '12 Gebäude beschädigt, 3 Leitungsfelder unterbrochen. Räume Trümmer, repariere die Netze und stelle die Versorgung wieder her.',
    'Das Stadtgebiet umfasst jetzt 128 × 128 Felder. Bestehende Wohn- und Arbeitsgebiete wurden erhalten; öffentliche Gebäude haben eigene große Grundstücke.',
  ];
  setLocale('en');
  for (const message of messages) {
    const translated=localizedEventMessage({message});
    assert.notEqual(translated,message,message);
  }
  assert.equal(localizedEventMessage({message:messages[3]}),'2,500 residents! The state is supporting your city with €5,000.');
  assert.equal(localizedEventMessage({message:messages[6]}),'€10,000 has been paid out. Monthly interest: 0.5%.');
});

test('all legacy quest reward names match their current English counterparts',()=>{
  const names=[
    ['Neue Verbindungen','New Connections'],['Raum zum Ankommen','Room to Settle'],
    ['Das Land gestalten','Shaping the Land'],['Unter und über der Stadt','Below and Above the City'],
    ['Eine verlässliche Stadt','A Reliable City'],['Arbeit vor Ort','Local Jobs'],
    ['Eine Stadt atmet auf','A City Breathes Again'],['Gut versorgt','In Good Hands'],
    ['Solide Finanzen','Sound Finances'],['Stadt des Wissens','City of Knowledge'],
    ['Tor zum Meer','Gateway to the Sea'],['Saubere Zukunft','A Clean Future'],
    ['Bereit zum Abheben','Ready for Takeoff'],['Die Stadt von morgen','The City of Tomorrow'],
  ];
  setLocale('en');
  for (const [de,en] of names) {
    const message=`${de}: +1.500 € und +1.000 EP.`;
    assert.equal(localizedEventMessage({message}),`${en}: +€1,500 and +1,000 XP.`);
    assert.equal(localizedEventMessage({message:`${de} — hole 1.500 € und 1.000 EP im Stadtziel-Fenster ab.`}),`${en} — collect €1,500 and 1,000 XP in the city goals window.`);
  }
});

test('legacy challenge starts, rewards and failures translate full descriptions and badge status',()=>{
  const challenges=[
    ['Aufbruch in die Metropole','Metropolitan Growth','60','Gewinne innerhalb von 60 Monaten 5.000 zusätzliche Einwohner gegenüber dem Start dieser Challenge.','Gain 5,000 additional residents within 60 months of starting this challenge.'],
    ['Grüne Hauptstadt','Green Capital','120','Erreiche innerhalb von 120 Monaten 10.000 Einwohner bei einer Umweltbelastung unter 10.','Reach 10,000 residents within 120 months while keeping pollution below 10.'],
    ['Goldene Stadtkasse','Golden Treasury','60','Steigere die Stadtkasse innerhalb von 60 Monaten um 150.000. Jeder neue Kredit beendet diese Challenge.','Increase the city treasury by €150,000 within 60 months. Any new loan ends this challenge.'],
  ];
  setLocale('en');
  for (const [de,en,months,description,descriptionEn] of challenges) {
    assert.equal(localizedEventMessage({message:`${de} gestartet. Du hast ${months} Monate. ${description}`}),`${en} started. You have ${months} months. ${descriptionEn}`);
    assert.equal(localizedEventMessage({message:`${de}: +20.000 € und +1.200 EP. Dein Abzeichen bleibt erhalten.`}),`${en}: +€20,000 and +1,200 XP. Your badge is permanent.`);
    assert.equal(localizedEventMessage({message:`${de}: Die Zeit ist abgelaufen. Du kannst es erneut versuchen.`}),`${en}: Time has run out. You can try again.`);
  }
  assert.equal(localizedEventMessage({message:'Ein neuer Kredit hat „Goldene Stadtkasse“ beendet. Du kannst die Challenge erneut versuchen.'}),'A new loan ended “Golden Treasury”. You can try the challenge again.');
});

test('legacy rank milestones translate their entire descriptions',()=>{
  const descriptions=[
    'Baue eine gut versorgte Stadt mit Wohnvierteln, kleinen Betrieben und vollständiger Grundversorgung. Gebäude entwickeln sich bis Stufe 2.',
    'Bahn, Wind- und Solarenergie, Stadion, Hafen und Recycling werden verfügbar. Deine Stadt wächst mit dichterer Bebauung bis Gebäudestufe 3.',
    'Universität, Flughafen und die höchsten Wohn- und Geschäftshäuser prägen deine Metropole. Gebäude entwickeln sich bis Stufe 4.',
  ];
  setLocale('en');
  for (const description of descriptions) {
    const translated=localizedEventMessage({message:`15.000 Einwohner erreicht. ${description}`});
    assert.ok(translated.startsWith('15,000 residents reached. '));
    assert.ok(!translated.includes(description));
    assert.ok(!translated.includes('Your city has reached a new development stage.'));
  }
});

test('unrecognized imported entries preserve their original meaning with an English label',()=>{
  const event={title:'Ein alter Sondereintrag',message:'Ein historischer Text.'};
  setLocale('en');
  assert.equal(localizedEventTitle(event),'Original event: Ein alter Sondereintrag');
  assert.equal(localizedEventMessage(event),'Ein historischer Text.');
  setLocale('de');
  assert.equal(localizedEventTitle(event),'Ein alter Sondereintrag');
  assert.equal(localizedEventMessage(event),'Ein historischer Text.');
});

test('custom imports resembling known templates do not lose unknown names or descriptions',()=>{
  setLocale('en');
  const customMessages=[
    'Mein eigener Auftrag: +1.500 € und +100 EP.',
    'Meine Challenge gestartet. Du hast 60 Monate. Gewinne zehn besondere Gebäude.',
    'Grüne Hauptstadt gestartet. Du hast 120 Monate. Eine geänderte persönliche Bedingung.',
    'Meine Challenge: Die Zeit ist abgelaufen. Du kannst es erneut versuchen.',
    '5.000 Einwohner erreicht. Eine eigene Beschreibung der Stadt.',
    'Mein Auftrag — hole 1.500 € und 100 EP im Stadtziel-Fenster ab.',
    'constructor: +1.500 € und +100 EP.',
    'toString',
  ];
  for (const message of customMessages) assert.equal(localizedEventMessage({message}),message);
  assert.equal(localizedEventTitle({title:'Ausbaustufe erreicht: Meine Stadt'}),'Original event: Ausbaustufe erreicht: Meine Stadt');
  assert.equal(localizedEventTitle({title:'constructor'}),'Original event: constructor');
});
