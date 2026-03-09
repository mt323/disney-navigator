// ── Config Constants ──────────────────────────────────
const PLAN_STORAGE_KEY = 'disney-plan-data-2026-03-16';
const STORAGE_KEY = 'disney-trip-2026-03-16';

const CORS_PROXIES = [
  url => 'https://corsproxy.io/?' + encodeURIComponent(url),
  url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
];
const QUEUE_TIMES_BASE = {
  dl: 'https://queue-times.com/parks/16/queue_times.json',
  dca: 'https://queue-times.com/parks/17/queue_times.json'
};
const LL_SLOTS_BASE = {
  dl: 'https://queue-times.com/en-US/parks/16/queue_times',
  dca: 'https://queue-times.com/en-US/parks/17/queue_times'
};

const LL_RIDE_IDS = {
  329: 'guardians',
  322: 'incredicoaster',
  312: 'soarin',
  14168: 'tianas',
  13958: 'haunted-mansion',
  323: 'big-thunder',
  284: 'space-mountain',
  279: 'matterhorn',
  273: 'buzz',
};

// ── LL Strategy Context (for Claude export prompt) ───
const LL_STRATEGY_CONTEXT = {
  rules: [
    'Can only hold 1 LL booking at a time',
    'After tapping in, can immediately book next LL',
    '2-hour rule: if return window is 2+ hours away, can book next LL 120 min after last booking without tapping in',
    'Each return window is 1 hour long',
    'Cross-park booking is allowed (book DL ride while at DCA)',
    'Tap at the second touchpoint (right before loading) to book next a few minutes earlier',
  ],
  demand: {
    'space-mountain':  { level: 5, note: 'Highest demand at DL. Windows push 2-3hr out by mid-afternoon. Book ASAP.' },
    'big-thunder':     { level: 4, note: 'Slots fill in 5-15 min. High demand.' },
    'guardians':       { level: 4, note: 'Highest demand at DCA. First booking at entry usually gets close window.' },
    'matterhorn':      { level: 4, note: 'Slots fill in 5-15 min. Similar to Big Thunder.' },
    'soarin':          { level: 4, note: 'Morning sells out fast, afternoon recovery around 1-2pm.' },
    'tianas':          { level: 3, note: 'Sells out mid-morning, afternoon slots reappear ~1pm.' },
    'haunted-mansion': { level: 2, note: 'Morning available, midday gap, afternoon recovery.' },
    'incredicoaster':  { level: 2, note: 'Better availability than Guardians. Moderate demand.' },
    'buzz':            { level: 1, note: 'Only 24 min standby avg. Often immediate return. Easiest LL.' },
  },
  geography: {
    crossParkWalk: 25,
    dcaAreas: { 'guardians': 'Avengers Campus', 'incredicoaster': 'Pixar Pier', 'soarin': 'Grizzly Peak' },
    dlAreas: {
      'tianas': 'Critter Country', 'haunted-mansion': 'New Orleans Sq', 'big-thunder': 'Frontierland',
      'space-mountain': 'Tomorrowland', 'matterhorn': 'Fantasyland', 'buzz': 'Tomorrowland',
    },
    dlWalkTimes: {
      'Critter Country → New Orleans Sq': 3, 'New Orleans Sq → Frontierland': 3,
      'Frontierland → Tomorrowland': 10, 'Tomorrowland → Fantasyland': 5,
      'Critter Country → Tomorrowland': 12, 'Fantasyland → Tomorrowland': 5,
    },
  },
  keyInsight: 'The goal is to minimize "block time" — time between booking an LL and being able to book the next one. You can only hold 1 LL at a time, so every minute blocked is a minute you can\'t progress the chain. Book rides whose windows are closest to when you\'d arrive. Protect high-demand rides (Space Mountain, Big Thunder) from selling out by booking them before their windows push too far.',
};

// ── Historical Wait Time Trends (March Monday) ──────
const HISTORICAL_TRENDS = {
  'radiator-springs': {
    name: 'Radiator Springs Racers',
    marchMondayAvg: '75-85',
    hourly: [
      { hours: '8-9', wait: '30-45' },
      { hours: '9-11', wait: '55-70' },
      { hours: '11-1', wait: '75-85' },
      { hours: '1-4', wait: '80-85' },
      { hours: '4-6', wait: '75-80' },
      { hours: '6-8', wait: '65-75' },
      { hours: '8+', wait: '50-65' },
    ],
    bestTime: 'Rope drop or last hour',
  },
  'guardians': {
    name: 'Guardians: Mission BREAKOUT',
    marchMondayAvg: '35-50',
    hourly: [
      { hours: '8-9', wait: '12-20' },
      { hours: '9-11', wait: '25-35' },
      { hours: '11-1', wait: '40-50' },
      { hours: '1-4', wait: '45-55' },
      { hours: '4-6', wait: '40-50' },
      { hours: '6-8', wait: '45-55' },
      { hours: '8+', wait: '35-45' },
    ],
    bestTime: 'First hour or after 8 PM',
  },
  'webslingers': {
    name: 'Web Slingers: Spider-Man',
    marchMondayAvg: '25-45',
    hourly: [
      { hours: '8-9', wait: '8-15' },
      { hours: '9-11', wait: '20-30' },
      { hours: '11-1', wait: '35-45' },
      { hours: '1-4', wait: '45-53' },
      { hours: '4-6', wait: '40-50' },
      { hours: '6-8', wait: '30-40' },
      { hours: '8+', wait: '15-25' },
    ],
    bestTime: 'First hour or evening',
  },
  'incredicoaster': {
    name: 'Incredicoaster',
    marchMondayAvg: '25-35',
    hourly: [
      { hours: '8-9', wait: '5-10' },
      { hours: '9-11', wait: '19-28' },
      { hours: '11-1', wait: '30-35' },
      { hours: '1-4', wait: '33-36' },
      { hours: '4-6', wait: '30-34' },
      { hours: '6-8', wait: '28-32' },
      { hours: '8+', wait: '20-28' },
    ],
    bestTime: 'Morning or evening',
  },
  'soarin': {
    name: "Soarin' Over California",
    marchMondayAvg: '30-50',
    hourly: [
      { hours: '8-9', wait: '8-15' },
      { hours: '9-11', wait: '25-35' },
      { hours: '11-1', wait: '40-48' },
      { hours: '1-4', wait: '48-52' },
      { hours: '4-6', wait: '48-52' },
      { hours: '6-8', wait: '38-45' },
      { hours: '8+', wait: '25-35' },
    ],
    bestTime: 'First hour or after 7 PM',
  },
  'indiana-jones': {
    name: 'Indiana Jones Adventure',
    marchMondayAvg: '40-55',
    hourly: [
      { hours: '8-9', wait: '22-30' },
      { hours: '9-11', wait: '35-47' },
      { hours: '11-1', wait: '47-50' },
      { hours: '1-4', wait: '50-51' },
      { hours: '4-6', wait: '48-51' },
      { hours: '6-8', wait: '42-48' },
      { hours: '8+', wait: '30-40' },
    ],
    bestTime: 'Rope drop or after 8 PM',
  },
  'tianas': {
    name: "Tiana's Bayou Adventure",
    marchMondayAvg: '30-55',
    hourly: [
      { hours: '8-9', wait: '5-15' },
      { hours: '9-11', wait: '25-40' },
      { hours: '11-1', wait: '45-54' },
      { hours: '1-4', wait: '54-58' },
      { hours: '4-6', wait: '49-56' },
      { hours: '6-8', wait: '30-42' },
      { hours: '8+', wait: '10-20' },
    ],
    bestTime: 'Rope drop or after 7 PM (drops to 10-20 near close)',
  },
  'haunted-mansion': {
    name: 'Haunted Mansion',
    marchMondayAvg: '25-45',
    hourly: [
      { hours: '8-9', wait: '17-28' },
      { hours: '9-11', wait: '28-40' },
      { hours: '11-1', wait: '40-46' },
      { hours: '1-4', wait: '42-46' },
      { hours: '4-6', wait: '39-44' },
      { hours: '6-8', wait: '39-44' },
      { hours: '8+', wait: '18-31' },
    ],
    bestTime: 'Morning or last hour',
  },
  'pirates': {
    name: 'Pirates of the Caribbean',
    marchMondayAvg: '20-30',
    hourly: [
      { hours: '8-9', wait: '6-10' },
      { hours: '9-11', wait: '15-22' },
      { hours: '11-1', wait: '25-29' },
      { hours: '1-4', wait: '27-29' },
      { hours: '4-6', wait: '25-28' },
      { hours: '6-8', wait: '20-25' },
      { hours: '8+', wait: '9-15' },
    ],
    bestTime: 'Anytime (high capacity)',
  },
  'big-thunder': {
    name: 'Big Thunder Mountain',
    marchMondayAvg: '30-40',
    hourly: [
      { hours: '8-9', wait: '11-20' },
      { hours: '9-11', wait: '20-34' },
      { hours: '11-1', wait: '34-37' },
      { hours: '1-4', wait: '37-38' },
      { hours: '4-6', wait: '37-38' },
      { hours: '6-8', wait: '35-36' },
      { hours: '8+', wait: '29-35' },
    ],
    bestTime: 'Rope drop or evening',
  },
  'space-mountain': {
    name: 'Space Mountain',
    marchMondayAvg: '45-60',
    hourly: [
      { hours: '8-9', wait: '10-25' },
      { hours: '9-11', wait: '30-45' },
      { hours: '11-1', wait: '50-58' },
      { hours: '1-5', wait: '58-62' },
      { hours: '5-7', wait: '55-60' },
      { hours: '7-9', wait: '45-55' },
      { hours: '9+', wait: '35-45' },
    ],
    bestTime: 'Rope drop or after 9 PM. Monday is historically busiest day (49 min avg).',
  },
  'star-tours': {
    name: 'Star Tours',
    marchMondayAvg: '20-35',
    hourly: [
      { hours: '8-9', wait: '5-9' },
      { hours: '9-11', wait: '15-28' },
      { hours: '11-1', wait: '33-36' },
      { hours: '1-3', wait: '35-36' },
      { hours: '3-5', wait: '30-35' },
      { hours: '5-8', wait: '25-30' },
      { hours: '8+', wait: '15-22' },
    ],
    bestTime: 'Morning or evening',
  },
  'matterhorn': {
    name: 'Matterhorn Bobsleds',
    marchMondayAvg: '35-50',
    hourly: [
      { hours: '8-9', wait: '13-24' },
      { hours: '9-11', wait: '24-44' },
      { hours: '11-1', wait: '44-49' },
      { hours: '1-4', wait: '49-50' },
      { hours: '4-6', wait: '47-49' },
      { hours: '6-8', wait: '44-45' },
      { hours: '8+', wait: '35-42' },
    ],
    bestTime: 'Rope drop or after 8 PM',
  },
  'smugglers-run': {
    name: "Smuggler's Run",
    marchMondayAvg: '30-45',
    hourly: [
      { hours: '8-9', wait: '20-30' },
      { hours: '9-11', wait: '30-46' },
      { hours: '11-1', wait: '45-46' },
      { hours: '1-4', wait: '43-44' },
      { hours: '4-6', wait: '39-42' },
      { hours: '6-8', wait: '33-35' },
      { hours: '8+', wait: '19-30' },
    ],
    bestTime: 'Evening (after 7 PM). Monday is busiest day.',
  },
  'rise': {
    name: 'Rise of the Resistance',
    marchMondayAvg: '60-75',
    hourly: [
      { hours: '8-9', wait: '58-61' },
      { hours: '9-11', wait: '61-73' },
      { hours: '11-1', wait: '71-73' },
      { hours: '1-4', wait: '67-68' },
      { hours: '4-6', wait: '66-67' },
      { hours: '6-8', wait: '64' },
      { hours: '8+', wait: '48-60' },
    ],
    bestTime: 'Rope drop or after 9 PM (~48 min). Declining year-over-year (86→59 min).',
  },
  'mr-toads': {
    name: "Mr. Toad's Wild Ride",
    marchMondayAvg: '15-20',
    hourly: [
      { hours: '8-9', wait: '7-10' },
      { hours: '9-11', wait: '10-19' },
      { hours: '11-1', wait: '19-20' },
      { hours: '1-4', wait: '20' },
      { hours: '4-6', wait: '20' },
      { hours: '6-8', wait: '19-20' },
      { hours: '8+', wait: '15-19' },
    ],
    bestTime: 'Anytime — manageable filler',
  },
  'buzz': {
    name: 'Buzz Lightyear Astro Blasters',
    marchMondayAvg: '15-25',
    hourly: [
      { hours: '8-9', wait: '5-9' },
      { hours: '9-11', wait: '9-25' },
      { hours: '11-1', wait: '25-28' },
      { hours: '1-4', wait: '26-28' },
      { hours: '4-6', wait: '26-27' },
      { hours: '6-8', wait: '24-25' },
      { hours: '8+', wait: '6-18' },
    ],
    bestTime: 'Morning or late evening',
  },
};

// ── LL Sellout Patterns ──────────────────────────────
const LL_SELLOUT_PATTERNS = {
  'guardians': 'Morning gone fast, gap 10am-12:25pm, afternoon recovery. Highest demand at DCA.',
  'incredicoaster': 'Mid-morning gap 10:45-12:05, afternoon recovery ~1:27pm. Moderate demand.',
  'soarin': 'Morning sells out fast by 7:40am. Progressive sellout through afternoon. High demand.',
  'tianas': 'Available until ~10:30am. Midday gap 10:35am-1pm. Afternoon scattered. Moderate-high demand.',
  'haunted-mansion': 'Morning available. Sellout ~10:30-10:35am. Peak unavailability 10:35am-12pm. Afternoon recovery. Moderate demand.',
  'big-thunder': 'Slots fill in 5-15 min windows. Brief availability pops throughout day. High demand.',
  'space-mountain': 'Hardest LL. Morning slots gone by 8am. Afternoon 1-2pm slots last longer. Very high demand.',
  'matterhorn': 'Slots sell out within 5-15 min. Second wave ~2:00-2:15pm. High demand.',
  'buzz': 'Available all morning until ~12:10pm. Easiest LL, often immediate return. Low demand.',
};

// ── Expert Strategies ────────────────────────────────
const EXPERT_STRATEGIES = [
  'Modify/refresh trick: book any LL then repeatedly refresh the modify screen to snag earlier cancelled slots (5 min patience = nearly 100% success)',
  'DCA-first park hop: complete DCA rides in morning, hop to DL where LL availability is still good',
  'Cross-park booking: after 11am, book LL at other park if return time is past 11am',
  'Pin high-priority rides to top of tip board for instant booking when slots appear',
  'Single Rider cuts 50-70% off waits at RSR, Incredicoaster, Web Slingers, Indiana Jones',
  'Evening (7pm-close) is second-best window — many rides drop 30-50% from peak',
  "Tiana's Bayou Adventure drops to 10-20 min near closing — excellent late option",
  'Space Mountain: Monday is historically busiest day (49 min avg). Book LL early.',
  'Rise of the Resistance: waits declining year-over-year (86 min 2021 → 59 min 2026). After 9pm drops to ~48 min.',
  'High-capacity fillers for midday: Pirates (20-30 min), Mr. Toad (15-20 min), Star Tours (20-35 min), Buzz (15-25 min)',
];

// ── Mitigation Strategies (per-ride contingency plans) ─
const MITIGATION_STRATEGIES = {
  'space-mountain': {
    risk: 'HIGH',
    issue: 'LL #7 — window often pushes to 5:00+ on Mondays (busiest day, 49 min avg standby)',
    mitigations: [
      'Modify/refresh trick: after booking, repeatedly pull-to-refresh the modify screen to snag cancelled slots (5 min patience = ~100% success)',
      'If window pushes past 5:30pm: Star Tours (4:18-4:48) fills the gap. Ride SM when window opens, continue chain from there',
      '2-hour rule backup: kicks in at ~5:48 for booking Matterhorn without tapping SM',
    ],
  },
  'rise': {
    risk: 'MEDIUM',
    issue: 'Standby can spike above 70 min despite evening dip trend',
    mitigations: [
      'Check app at 6:00pm — Monday evenings usually dip to 45-55 min by 6:30-7:00pm',
      'If 70+ at 6:30, adjust dinner timing or substitute Star Tours',
      'YoY declining (86→59 min avg) — trend favors lower waits in 2026',
    ],
  },
  'haunted-mansion': {
    risk: 'MEDIUM',
    issue: 'May have Virtual Queue due to construction',
    mitigations: [
      'If VQ active: drop from LL chain. Book Tiana\'s → Big Thunder → SM → Matterhorn → Buzz → Star Tours',
      'Join HM VQ separately in the app when a boarding group drops',
    ],
  },
  'big-thunder': {
    risk: 'MEDIUM',
    issue: 'LL slots fill in 5-15 min windows',
    mitigations: [
      'Book immediately after tapping Haunted Mansion — do not delay',
      'If sold out: use 2-hour rule to skip ahead in chain, come back to Big Thunder standby (35-38 min at 3-4pm)',
    ],
  },
  'general': {
    risk: null,
    issue: 'LL return window pushed 2+ hours out',
    mitigations: [
      '2-hour rule: book next LL exactly 120 min after last booking without needing to tap in',
      'Fill gap with standby fillers: Pirates (25 min), Mr. Toad (20 min), Star Tours (30 min), Buzz (15-25 min)',
      'Modify/refresh trick works on any LL — not just Space Mountain',
    ],
  },
};

// ── Default Plan Data ─────────────────────────────────
const DEFAULT_PLAN = {
  version: 1,
  meta: {
    title: 'Disneyland Navigator',
    date: 'Monday, March 16, 2026',
    cost: '~$34/person \u00b7 Lightning Lane Multi Pass'
  },
  schedule: [
    // DCA
    {id:'enter-dca',time:'11:00',m:660,title:'Enter DCA \u2014 Book LL #1: Guardians',park:'dca',type:'action',method:null,wait:null,isMustDo:false,llNote:null},
    {id:'walk-carsland',time:'11:05',m:665,title:'Walk to Cars Land',park:'dca',type:'walk',method:null,wait:10,isMustDo:false,llNote:null},
    {id:'radiator-springs',time:'11:15',m:675,title:'Radiator Springs Racers',park:'dca',type:'ride',method:'sr',wait:15,isMustDo:true,llNote:null},
    {id:'walk-avengers',time:'11:35',m:695,title:'Walk to Avengers Campus',park:'dca',type:'walk',method:null,wait:8,isMustDo:false,llNote:null},
    {id:'guardians',time:'11:45',m:705,title:'Guardians: Mission BREAKOUT',park:'dca',type:'ride',method:'ll',wait:10,isMustDo:true,llNote:'Tap in \u2192 book LL #2: Incredicoaster'},
    {id:'walk-webslingers',time:'12:00',m:720,title:'Walk to Web Slingers',park:'dca',type:'walk',method:null,wait:2,isMustDo:false,llNote:null},
    {id:'webslingers',time:'12:05',m:725,title:'Web Slingers: Spider-Man',park:'dca',type:'ride',method:'sr',wait:10,isMustDo:false,llNote:null},
    {id:'walk-pixarpier',time:'12:20',m:740,title:'Walk to Pixar Pier',park:'dca',type:'walk',method:null,wait:5,isMustDo:false,llNote:null},
    {id:'incredicoaster',time:'12:30',m:750,title:'Incredicoaster',park:'dca',type:'ride',method:'ll',wait:5,isMustDo:false,llNote:'Tap in \u2192 book LL #3: Soarin\' Over California',hasSr:true},
    {id:'walk-grizzly',time:'12:40',m:760,title:'Walk to Grizzly Peak',park:'dca',type:'walk',method:null,wait:7,isMustDo:false,llNote:null},
    {id:'soarin',time:'12:50',m:770,title:'Soarin\' Over California',park:'dca',type:'ride',method:'ll',wait:10,isMustDo:false,llNote:'Tap in \u2192 book LL #4: Tiana\'s Bayou Adventure (Disneyland!)'},
    {id:'lunch',time:'1:05',m:785,title:'Lunch \u2014 San Fransokyo Square',park:'dca',type:'meal',method:null,wait:25,isMustDo:false,llNote:null},
    {id:'walk-disneyland',time:'1:30',m:810,title:'Walk to Disneyland',park:'dca',type:'walk',method:null,wait:25,isMustDo:false,llNote:null},

    // Disneyland
    {id:'enter-dl',time:'1:55',m:835,title:'Enter Disneyland \u2014 Walk to Adventureland',park:'dl',type:'action',method:null,wait:7,isMustDo:false,llNote:null},
    {id:'indiana-jones',time:'2:05',m:845,title:'Indiana Jones Adventure',park:'dl',type:'ride',method:'sr',wait:18,isMustDo:true,llNote:null},
    {id:'walk-critter',time:'2:25',m:865,title:'Walk to Critter Country',park:'dl',type:'walk',method:null,wait:5,isMustDo:false,llNote:null},
    {id:'tianas',time:'2:35',m:875,title:'Tiana\'s Bayou Adventure',park:'dl',type:'ride',method:'ll',wait:10,isMustDo:false,llNote:'Tap in \u2192 book LL #5: Haunted Mansion'},
    {id:'walk-neworleans',time:'2:48',m:888,title:'Walk to New Orleans Square',park:'dl',type:'walk',method:null,wait:3,isMustDo:false,llNote:null},
    {id:'haunted-mansion',time:'2:53',m:893,title:'Haunted Mansion',park:'dl',type:'ride',method:'ll',wait:10,isMustDo:true,llNote:'Tap in \u2192 book LL #6: Big Thunder'},
    {id:'pirates',time:'3:06',m:906,title:'Pirates of the Caribbean',park:'dl',type:'ride',method:'standby',wait:25,isMustDo:false,llNote:null},
    {id:'walk-frontier',time:'3:33',m:933,title:'Walk to Frontierland',park:'dl',type:'walk',method:null,wait:3,isMustDo:false,llNote:null},
    {id:'big-thunder',time:'3:38',m:938,title:'Big Thunder Mountain',park:'dl',type:'ride',method:'ll',wait:10,isMustDo:true,llNote:'Tap in \u2192 book LL #7: Space Mountain'},
    {id:'walk-tomorrow1',time:'3:50',m:950,title:'Walk to Tomorrowland',park:'dl',type:'walk',method:null,wait:10,isMustDo:false,llNote:null},
    {id:'space-mountain',time:'4:02',m:962,title:'Space Mountain',park:'dl',type:'ride',method:'ll',wait:10,isMustDo:true,llNote:'Tap in \u2192 book LL #8: Matterhorn'},
    {id:'walk-startours',time:'4:15',m:975,title:'Walk to Star Tours',park:'dl',type:'walk',method:null,wait:3,isMustDo:false,llNote:null},
    {id:'star-tours',time:'4:18',m:978,title:'Star Tours',park:'dl',type:'ride',method:'standby',wait:30,isMustDo:false,llNote:null},
    {id:'walk-fantasy',time:'4:50',m:1010,title:'Walk to Fantasyland',park:'dl',type:'walk',method:null,wait:5,isMustDo:false,llNote:null},
    {id:'matterhorn',time:'4:57',m:1017,title:'Matterhorn Bobsleds',park:'dl',type:'ride',method:'ll',wait:10,isMustDo:false,llNote:'Tap in \u2192 book LL #9: Buzz Lightyear',hasSr:true},
    {id:'walk-mrtoads',time:'5:10',m:1030,title:'Walk to Mr. Toad\'s',park:'dl',type:'walk',method:null,wait:3,isMustDo:false,llNote:null},
    {id:'mr-toads',time:'5:13',m:1033,title:'Mr. Toad\'s Wild Ride',park:'dl',type:'ride',method:'standby',wait:20,isMustDo:false,llNote:null},
    {id:'walk-tomorrow2',time:'5:33',m:1053,title:'Walk to Tomorrowland',park:'dl',type:'walk',method:null,wait:5,isMustDo:false,llNote:null},
    {id:'buzz',time:'5:40',m:1060,title:'Buzz Lightyear Astro Blasters',park:'dl',type:'ride',method:'ll',wait:5,isMustDo:false,llNote:null},
    {id:'walk-galaxy',time:'5:48',m:1068,title:'Walk to Galaxy\'s Edge',park:'dl',type:'walk',method:null,wait:8,isMustDo:false,llNote:null},
    {id:'smugglers-run',time:'5:58',m:1078,title:'Smuggler\'s Run',park:'dl',type:'ride',method:'sr',wait:12,isMustDo:false,llNote:null},
    {id:'dinner',time:'6:11',m:1091,title:'Dinner \u2014 Docking Bay 7',park:'dl',type:'meal',method:null,wait:35,isMustDo:false,llNote:null},
    {id:'rise',time:'6:48',m:1128,title:'Rise of the Resistance',park:'dl',type:'ride',method:'standby',wait:60,isMustDo:true,llNote:null},
    {id:'rise-experience',time:'7:48',m:1188,title:'Experience Rise (pre-shows)',park:'dl',type:'action',method:null,wait:null,isMustDo:false,llNote:null},
    {id:'free-time',time:'8:10',m:1210,title:'Main Street shopping, churros',park:'dl',type:'action',method:null,wait:20,isMustDo:false,llNote:null},
    {id:'head-out',time:'8:30',m:1230,title:'Head out!',park:'dl',type:'action',method:null,wait:null,isMustDo:false,llNote:null},
  ],
  llChain: [
    {num:1,trigger:'11:00 (park entry)',ride:'Guardians: Mission BREAKOUT',park:'dca',rideId:'guardians',note:'Window ~11:30-12:00'},
    {num:2,trigger:'Tap Guardians',ride:'Incredicoaster',park:'dca',rideId:'incredicoaster',note:'Window ~12:00-12:30'},
    {num:3,trigger:'Tap Incredicoaster',ride:'Soarin\' Over California',park:'dca',rideId:'soarin',note:'Window ~12:30-1:00'},
    {num:4,trigger:'Tap Soarin\'',ride:'Tiana\'s Bayou Adventure',park:'dl',rideId:'tianas',note:'Cross-park book. Window ~2:00-2:30'},
    {num:5,trigger:'Tap Tiana\'s',ride:'Haunted Mansion',park:'dl',rideId:'haunted-mansion',note:'Window ~2:45-3:15'},
    {num:6,trigger:'Tap Haunted Mansion',ride:'Big Thunder Mountain',park:'dl',rideId:'big-thunder',note:'Slots fill fast. Window ~3:15-3:45'},
    {num:7,trigger:'Tap Big Thunder',ride:'Space Mountain',park:'dl',rideId:'space-mountain',note:'Hardest LL \u2014 window may push to 5:00+. Use modify/refresh trick'},
    {num:8,trigger:'Tap Space Mountain',ride:'Matterhorn Bobsleds',park:'dl',rideId:'matterhorn',note:'Window ~5:00-5:30. 2-hour rule backup at ~5:48'},
    {num:9,trigger:'Tap Matterhorn',ride:'Buzz Lightyear Astro Blasters',park:'dl',rideId:'buzz',note:'Easiest LL. Often immediate return'},
  ],
  mustDos: [
    {id:'radiator-springs',title:'Radiator Springs Racers',park:'DCA',method:'SR'},
    {id:'guardians',title:'Guardians: Mission BREAKOUT',park:'DCA',method:'LL'},
    {id:'rise',title:'Rise of the Resistance',park:'Disneyland',method:'Standby'},
    {id:'indiana-jones',title:'Indiana Jones Adventure',park:'Disneyland',method:'SR'},
    {id:'space-mountain',title:'Space Mountain',park:'Disneyland',method:'LL'},
    {id:'big-thunder',title:'Big Thunder Mountain',park:'Disneyland',method:'LL'},
    {id:'haunted-mansion',title:'Haunted Mansion',park:'Disneyland',method:'LL'},
  ],
  contingencies: [
    {title:'Haunted Mansion has Virtual Queue',body:'Drop it from the LL chain. Book Tiana\'s \u2192 Big Thunder \u2192 Space Mountain \u2192 Matterhorn \u2192 Buzz \u2192 Star Tours. Join the Haunted Mansion VQ in the app when it drops.'},
    {title:'Rise of the Resistance standby exceeds 70 min',body:'Check the app at 6:00. If it\'s 70+, consider adjusting dinner timing or riding Star Tours again instead. Monday evenings usually dip to 45-55 min by 6:30-7:00pm.'},
    {title:'LL return window pushed way out',body:'Use the 2-hour rule \u2014 if your window is 2+ hours away, you can book your next LL exactly 120 min after your last booking without tapping in.'},
    {title:'Web Slingers SR is unusually long',body:'Use LL instead and redirect the freed SR time. Swap your LL chain to book Web Slingers early and use the saved slot for Toy Story Midway Mania later.'},
    {title:'Jungle Cruise is open',body:'It may have reopened from refurbishment by March 2026. If open, consider swapping it for Mr. Toad\'s Wild Ride \u2014 it\'s right in Adventureland near Indiana Jones.'},
  ],
  proTips: [
    'Buy Multi Pass on March 9 (7 days ahead, 7:00am PT) to lock in the lowest price.',
    'Mobile order lunch at 12:30 while walking to Incredicoaster \u2014 pickup at San Fransokyo Square after Soarin\'.',
    'Mobile order dinner at 5:30 for Docking Bay 7 \u2014 pickup after Smuggler\'s Run.',
    'Soarin\' is currently "Over California" for DCA\'s 25th anniversary (through July 1, 2026) \u2014 the original film.',
    'Smuggler\'s Run double rider \u2014 pairs of 2 can ride together now. You\'ll likely be engineers but the ride is still great.',
    'Rise of the Resistance queue is themed and incredible \u2014 don\'t rush through it.',
    'Bring a portable charger \u2014 the Disneyland app drains battery with all the LL bookings.',
    'March 16 is before spring break (LAUSD starts ~March 30) \u2014 moderate Monday crowds expected.',
    'Tap at the second touchpoint (right before loading zone) to book your next LL a few minutes earlier.',
  ]
};
