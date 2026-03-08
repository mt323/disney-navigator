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
    {id:'lunch',time:'1:05',m:785,title:'Lunch \u2014 San Fransokyo Square',park:'dca',type:'meal',method:null,wait:30,isMustDo:false,llNote:null},
    {id:'walk-disneyland',time:'1:35',m:815,title:'Walk to Disneyland',park:'dca',type:'walk',method:null,wait:25,isMustDo:false,llNote:null},

    // Disneyland
    {id:'enter-dl',time:'2:00',m:840,title:'Enter Disneyland \u2014 Walk to Adventureland',park:'dl',type:'action',method:null,wait:7,isMustDo:false,llNote:null},
    {id:'indiana-jones',time:'2:10',m:850,title:'Indiana Jones Adventure',park:'dl',type:'ride',method:'sr',wait:18,isMustDo:true,llNote:null},
    {id:'walk-critter',time:'2:33',m:873,title:'Walk to Critter Country',park:'dl',type:'walk',method:null,wait:5,isMustDo:false,llNote:null},
    {id:'tianas',time:'2:40',m:880,title:'Tiana\'s Bayou Adventure',park:'dl',type:'ride',method:'ll',wait:10,isMustDo:false,llNote:'Tap in \u2192 book LL #5: Haunted Mansion'},
    {id:'walk-neworleans',time:'2:53',m:893,title:'Walk to New Orleans Square',park:'dl',type:'walk',method:null,wait:3,isMustDo:false,llNote:null},
    {id:'haunted-mansion',time:'2:58',m:898,title:'Haunted Mansion',park:'dl',type:'ride',method:'ll',wait:10,isMustDo:true,llNote:'Tap in \u2192 book LL #6: Big Thunder'},
    {id:'pirates',time:'3:11',m:911,title:'Pirates of the Caribbean',park:'dl',type:'ride',method:'standby',wait:22,isMustDo:false,llNote:null},
    {id:'walk-frontier',time:'3:36',m:936,title:'Walk to Frontierland',park:'dl',type:'walk',method:null,wait:3,isMustDo:false,llNote:null},
    {id:'big-thunder',time:'3:41',m:941,title:'Big Thunder Mountain',park:'dl',type:'ride',method:'ll',wait:10,isMustDo:true,llNote:'Tap in \u2192 book LL #7: Space Mountain'},
    {id:'walk-tomorrow1',time:'3:54',m:954,title:'Walk to Tomorrowland',park:'dl',type:'walk',method:null,wait:10,isMustDo:false,llNote:null},
    {id:'space-mountain',time:'4:06',m:966,title:'Space Mountain',park:'dl',type:'ride',method:'ll',wait:10,isMustDo:true,llNote:'Tap in \u2192 book LL #8: Matterhorn'},
    {id:'walk-startours',time:'4:19',m:979,title:'Walk to Star Tours',park:'dl',type:'walk',method:null,wait:3,isMustDo:false,llNote:null},
    {id:'star-tours',time:'4:22',m:982,title:'Star Tours',park:'dl',type:'ride',method:'standby',wait:28,isMustDo:false,llNote:null},
    {id:'walk-fantasy',time:'4:50',m:1010,title:'Walk to Fantasyland',park:'dl',type:'walk',method:null,wait:5,isMustDo:false,llNote:null},
    {id:'matterhorn',time:'4:57',m:1017,title:'Matterhorn Bobsleds',park:'dl',type:'ride',method:'ll',wait:10,isMustDo:false,llNote:'Tap in \u2192 book LL #9: Buzz Lightyear',hasSr:true},
    {id:'walk-mrtoads',time:'5:10',m:1030,title:'Walk to Mr. Toad\'s',park:'dl',type:'walk',method:null,wait:3,isMustDo:false,llNote:null},
    {id:'mr-toads',time:'5:13',m:1033,title:'Mr. Toad\'s Wild Ride',park:'dl',type:'ride',method:'standby',wait:20,isMustDo:false,llNote:null},
    {id:'walk-tomorrow2',time:'5:33',m:1053,title:'Walk to Tomorrowland',park:'dl',type:'walk',method:null,wait:5,isMustDo:false,llNote:null},
    {id:'buzz',time:'5:40',m:1060,title:'Buzz Lightyear Astro Blasters',park:'dl',type:'ride',method:'ll',wait:5,isMustDo:false,llNote:null},
    {id:'walk-galaxy',time:'5:48',m:1068,title:'Walk to Galaxy\'s Edge',park:'dl',type:'walk',method:null,wait:8,isMustDo:false,llNote:null},
    {id:'smugglers-run',time:'5:58',m:1078,title:'Smuggler\'s Run',park:'dl',type:'ride',method:'sr',wait:10,isMustDo:false,llNote:null},
    {id:'dinner',time:'6:11',m:1091,title:'Dinner \u2014 Docking Bay 7',park:'dl',type:'meal',method:null,wait:35,isMustDo:false,llNote:null},
    {id:'rise',time:'6:48',m:1128,title:'Rise of the Resistance',park:'dl',type:'ride',method:'standby',wait:64,isMustDo:true,llNote:null},
    {id:'rise-experience',time:'7:52',m:1192,title:'Experience Rise (pre-shows)',park:'dl',type:'action',method:null,wait:null,isMustDo:false,llNote:null},
    {id:'free-time',time:'8:10',m:1210,title:'Main Street shopping, churros',park:'dl',type:'action',method:null,wait:20,isMustDo:false,llNote:null},
    {id:'head-out',time:'8:30',m:1230,title:'Head out!',park:'dl',type:'action',method:null,wait:null,isMustDo:false,llNote:null},
  ],
  llChain: [
    {num:1,trigger:'11:00 (park entry)',ride:'Guardians: Mission BREAKOUT',park:'dca',rideId:'guardians'},
    {num:2,trigger:'Tap Guardians',ride:'Incredicoaster',park:'dca',rideId:'incredicoaster'},
    {num:3,trigger:'Tap Incredicoaster',ride:'Soarin\' Over California',park:'dca',rideId:'soarin',note:null},
    {num:4,trigger:'Tap Soarin\'',ride:'Tiana\'s Bayou Adventure',park:'dl',rideId:'tianas',note:'Cross-park book \u2014 the key move'},
    {num:5,trigger:'Tap Tiana\'s',ride:'Haunted Mansion',park:'dl',rideId:'haunted-mansion'},
    {num:6,trigger:'Tap Haunted Mansion',ride:'Big Thunder Mountain',park:'dl',rideId:'big-thunder'},
    {num:7,trigger:'Tap Big Thunder',ride:'Space Mountain',park:'dl',rideId:'space-mountain'},
    {num:8,trigger:'Tap Space Mountain',ride:'Matterhorn Bobsleds',park:'dl',rideId:'matterhorn'},
    {num:9,trigger:'Tap Matterhorn',ride:'Buzz Lightyear Astro Blasters',park:'dl',rideId:'buzz'},
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
