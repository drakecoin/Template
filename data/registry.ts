import type { SchedEntry } from "@kerbside/engine";

/**
 * Config-driven borough registry — the single declarative source of truth for
 * every London local authority the ETL knows about.
 *
 * Each entry can carry two things:
 *  - a borough-level `fallback` CPZ (real boundary polygon + indicative hours),
 *    used everywhere a borough has no precise per-zone data yet, and
 *  - an optional open-data `portal` (Socrata today) declaring how to discover
 *    that borough's per-zone CPZ layer and bay-level dataset.
 *
 * Adding a borough is a matter of appending an entry: the ETL loops over this
 * list, so a new Socrata borough with a CPZ/bays portal "slots in" with no code
 * change, and a new fallback immediately gives that borough's kerbside a zone
 * (which is what lets Mapillary parking signs there be priced and shown).
 *
 * Provenance discipline (see CLAUDE.md): fallbacks are `verified:false` and the
 * UI labels them "indicative". Precise portal-sourced zones are verified when
 * they carry the council's own control hours (or a hours we hand-checked).
 */

export interface CpzHours {
  days: number[];
  from: string;
  to: string;
}

/** How to import a borough's precise per-zone CPZ layer from its Socrata portal. */
export interface CpzPortal {
  /** Catalogue search query used to discover the dataset. */
  query: string;
  /** Filter over discovered dataset names (guards against unrelated hits). */
  match: RegExp;
  ratePence: number;
  maxStayHours: number;
  /**
   * Hand-verified hours by normalized sub-zone code (uppercase alphanumerics
   * only), used only where the portal layer itself carries no control-hours
   * fields. Keep the source citations in docs/SPEC.md §5.
   */
  verifiedHours?: Record<string, CpzHours[]>;
}

/** How to import a borough's bay-level dataset from its Socrata portal. */
export interface BaysPortal {
  query: string;
  match: RegExp;
}

export interface SocrataPortal {
  kind: "socrata";
  domain: string;
  cpz?: CpzPortal;
  bays?: BaysPortal;
}

/**
 * How to import a borough's per-zone CPZ layer from an ArcGIS Feature/Map
 * Service — the Esri "INSPIRE" open-data pattern most London boroughs use.
 * `layerUrl` points straight at the queryable layer (…/FeatureServer/0 or
 * …/MapServer/10); there's no Socrata-style catalogue to discover it through.
 */
export interface ArcgisCpzPortal {
  layerUrl: string;
  /** Attribute columns whose space-joined text carries the control schedule. */
  hoursFields: string[];
  /** Zone-code column; omit when the code lives inside the hours text ("Zone X"). */
  zoneField?: string;
  ratePence: number;
  maxStayHours: number;
}

export interface ArcgisPortal {
  kind: "arcgis";
  cpz?: ArcgisCpzPortal;
}

/**
 * How to import a borough's CPZ layer from an Astun **iShare** site (OpenLayers
 * front-end over a MapServer WFS at {baseUrl}/getows.ashx). Geometry comes back
 * as GML in native British National Grid and is reprojected to WGS84; control
 * hours come from a free-text attribute (`hoursField`).
 */
export interface IshareCpzPortal {
  /** iShare site root, e.g. "https://my.haringey.gov.uk/". */
  baseUrl: string;
  /** Map profile, e.g. "mapsources/AllMaps". */
  mapsource: string;
  /** WFS feature type / layer name, e.g. "Controlled_Parking_Zones". */
  typename: string;
  /** Attribute carrying the zone name. */
  nameField: string;
  /** Attribute carrying the free-text control hours. */
  hoursField: string;
  ratePence: number;
  maxStayHours: number;
}

export interface IsharePortal {
  kind: "ishare";
  cpz?: IshareCpzPortal;
}

export type Portal = SocrataPortal | ArcgisPortal | IsharePortal;

/** Borough-level fallback zone: real boundary + indicative, unverified hours. */
export interface BoroughFallback {
  id: string;
  name: string;
  sched: SchedEntry[];
  ratePence: number;
  maxStayHours: number;
}

export interface BoroughEntry {
  /** Feature name in the boroughs GeoJSON — the spatial join key. */
  borough: string;
  /** Human display name and per-zone name prefix, e.g. "Camden". */
  displayName: string;
  /** Prefix for precise per-zone record ids, e.g. "cam" -> "cam-ca-b". */
  zoneIdPrefix: string;
  /** Council parking page (record provenance). */
  src: string;
  /** Borough-wide indicative fallback zone (null only if never controlled). */
  fallback: BoroughFallback | null;
  /** Optional live open-data portal for precise CPZ/bay data. */
  portal?: Portal;
}

const MF = [1, 2, 3, 4, 5];
const MS = [1, 2, 3, 4, 5, 6];

/**
 * Camden hours we verified against camden.gov.uk (July 2026). Keyed by
 * normalized sub-zone code; only used when the portal lacks control-hours
 * fields for that sub-zone.
 */
const CAMDEN_VERIFIED_HOURS: Record<string, CpzHours[]> = {
  CAFN: [
    { days: MF, from: "08:30", to: "23:00" },
    { days: [0, 6], from: "09:30", to: "23:00" },
  ],
  CAD: [
    { days: MF, from: "08:30", to: "18:30" },
    { days: [6], from: "08:30", to: "13:30" },
  ],
  CAU: [{ days: MF, from: "10:00", to: "12:00" }],
};

/**
 * Every London local authority, keyed by its boundary-feature name. The first
 * block (through Wandsworth) are the inner/near-inner boroughs whose kerbside is
 * effectively all-controlled, so a borough-wide fallback is a fair generalisation;
 * the outer boroughs after carry lighter, town-centre-typical indicative hours
 * (their control is patchy — flagged indicative, verify on street).
 */
export const BOROUGHS: BoroughEntry[] = [
  {
    borough: "Camden",
    displayName: "Camden",
    zoneIdPrefix: "cam",
    src: "https://www.camden.gov.uk/controlled-parking-zones",
    fallback: {
      id: "boro-camden",
      name: "Camden CPZ (borough-wide)",
      sched: [
        { days: MF, from: "08:30", to: "18:30" },
        { days: [6], from: "08:30", to: "13:30" },
      ],
      ratePence: 700,
      maxStayHours: 4,
    },
    portal: {
      kind: "socrata",
      domain: "opendata.camden.gov.uk",
      cpz: {
        query: "controlled parking",
        match: /controlled parking|cpz/i,
        ratePence: 700,
        maxStayHours: 4,
        verifiedHours: CAMDEN_VERIFIED_HOURS,
      },
      bays: { query: "parking bays", match: /parking bays/i },
    },
  },
  {
    borough: "Islington",
    displayName: "Islington",
    zoneIdPrefix: "isl",
    src: "https://www.islington.gov.uk/parking/parking-restrictions/controlled-parking-zones",
    fallback: {
      id: "boro-islington",
      name: "Islington CPZ (borough-wide)",
      sched: [
        { days: MF, from: "08:30", to: "18:30" },
        { days: [6], from: "08:30", to: "13:30" },
      ],
      ratePence: 650,
      maxStayHours: 4,
    },
  },
  {
    borough: "Westminster",
    displayName: "Westminster",
    zoneIdPrefix: "wmn",
    src: "https://www.westminster.gov.uk/parking/parking-zones-and-prices",
    fallback: {
      id: "boro-westminster",
      name: "Westminster CPZ (borough-wide)",
      sched: [{ days: MS, from: "08:30", to: "18:30" }],
      ratePence: 890,
      maxStayHours: 4,
    },
  },
  {
    borough: "City of London",
    displayName: "City of London",
    zoneIdPrefix: "col",
    src: "https://www.cityoflondon.gov.uk/services/parking",
    fallback: {
      id: "boro-city",
      name: "City of London CPZ",
      sched: [{ days: MF, from: "08:30", to: "18:30" }],
      ratePence: 670,
      maxStayHours: 4,
    },
  },
  {
    borough: "Hackney",
    displayName: "Hackney",
    zoneIdPrefix: "hck",
    src: "https://hackney.gov.uk/parking-zones",
    fallback: {
      id: "boro-hackney",
      name: "Hackney CPZ (borough-wide)",
      sched: [{ days: MF, from: "08:30", to: "18:30" }],
      ratePence: 500,
      maxStayHours: 4,
    },
  },
  {
    borough: "Tower Hamlets",
    displayName: "Tower Hamlets",
    zoneIdPrefix: "twh",
    src: "https://www.towerhamlets.gov.uk/lgnl/transport_and_streets/parking/parking.aspx",
    fallback: {
      id: "boro-towerhamlets",
      name: "Tower Hamlets CPZ (borough-wide)",
      sched: [{ days: MF, from: "08:30", to: "17:30" }],
      ratePence: 450,
      maxStayHours: 4,
    },
  },
  {
    borough: "Kensington and Chelsea",
    displayName: "Kensington & Chelsea",
    zoneIdPrefix: "rbkc",
    src: "https://www.rbkc.gov.uk/parking/parking-zones-and-bays",
    fallback: {
      id: "boro-rbkc",
      name: "Kensington & Chelsea CPZ (borough-wide)",
      sched: [{ days: MS, from: "08:30", to: "18:30" }],
      ratePence: 650,
      maxStayHours: 4,
    },
  },
  {
    borough: "Hammersmith and Fulham",
    displayName: "Hammersmith & Fulham",
    zoneIdPrefix: "hf",
    src: "https://www.lbhf.gov.uk/parking",
    fallback: {
      id: "boro-hf",
      name: "Hammersmith & Fulham CPZ (most streets)",
      sched: [{ days: MF, from: "09:00", to: "17:00" }],
      ratePence: 480,
      maxStayHours: 4,
    },
    portal: {
      kind: "arcgis",
      cpz: {
        // LB Hammersmith & Fulham CPZ layer (Esri INSPIRE) hosted on the RBKC
        // shared ArcGIS server; separate ZONE_/DAYS/TIME_ columns.
        layerUrl: "https://www.rbkc.gov.uk/arcgis/rest/services/LBHF/INSPIRE/MapServer/10",
        zoneField: "ZONE_",
        hoursFields: ["DAYS", "TIME_"],
        ratePence: 250,
        maxStayHours: 4,
      },
    },
  },
  {
    borough: "Lambeth",
    displayName: "Lambeth",
    zoneIdPrefix: "lam",
    src: "https://www.lambeth.gov.uk/parking-transport-streets/parking/controlled-parking-zones-cpzs",
    fallback: {
      id: "boro-lambeth",
      name: "Lambeth CPZ (most streets)",
      sched: [{ days: MF, from: "08:30", to: "18:30" }],
      ratePence: 440,
      maxStayHours: 4,
    },
    portal: {
      kind: "arcgis",
      cpz: {
        // Lambeth open-data "Controlled Parking Zones" (CPZSolid) ArcGIS Online
        // FeatureServer: per-zone polygons + a free-text HOURS attribute
        // ("8:30am - 5:30pm Monday - Friday") parsed by the shared schedule parser.
        layerUrl:
          "https://services5.arcgis.com/YzAbPjFO62myKADc/arcgis/rest/services/CPZSolid/FeatureServer/0",
        hoursFields: ["HOURS"],
        zoneField: "NAME",
        ratePence: 440,
        maxStayHours: 4,
      },
    },
  },
  {
    borough: "Southwark",
    displayName: "Southwark",
    zoneIdPrefix: "swk",
    src: "https://www.southwark.gov.uk/parking/parking-zones",
    fallback: {
      id: "boro-southwark",
      name: "Southwark CPZ (most streets)",
      sched: [{ days: MF, from: "08:30", to: "18:30" }],
      ratePence: 460,
      maxStayHours: 3,
    },
  },
  {
    borough: "Wandsworth",
    displayName: "Wandsworth",
    zoneIdPrefix: "wns",
    src: "https://www.wandsworth.gov.uk/parking/",
    fallback: {
      id: "boro-wandsworth",
      name: "Wandsworth CPZ (most streets)",
      sched: [{ days: MF, from: "09:00", to: "17:00" }],
      ratePence: 450,
      maxStayHours: 4,
    },
  },

  // --- Near-inner / remaining boroughs with broad CPZ coverage ---------------
  {
    borough: "Haringey",
    displayName: "Haringey",
    zoneIdPrefix: "hgy",
    src: "https://haringey.gov.uk/parking/cpzs/all-cpz-hours",
    fallback: {
      id: "boro-haringey",
      name: "Haringey CPZ (most streets)",
      sched: [{ days: MF, from: "08:00", to: "18:30" }],
      ratePence: 420,
      maxStayHours: 4,
    },
    portal: {
      kind: "ishare",
      cpz: {
        // Haringey's CPZ map is an Astun iShare site; its MapServer WFS carries
        // per-zone polygons + a free-text `op_times` control-hours attribute.
        baseUrl: "https://my.haringey.gov.uk/",
        mapsource: "mapsources/AllMaps",
        typename: "Controlled_Parking_Zones",
        nameField: "cpz_name",
        hoursField: "op_times",
        ratePence: 420,
        maxStayHours: 4,
      },
    },
  },
  {
    borough: "Lewisham",
    displayName: "Lewisham",
    zoneIdPrefix: "lew",
    src: "https://lewisham.gov.uk/myservices/parking",
    fallback: {
      id: "boro-lewisham",
      name: "Lewisham CPZ (town-centre streets)",
      sched: [{ days: MF, from: "08:30", to: "18:30" }],
      ratePence: 400,
      maxStayHours: 4,
    },
  },
  {
    borough: "Newham",
    displayName: "Newham",
    zoneIdPrefix: "nwm",
    src: "https://www.newham.gov.uk/parking-roads-travel",
    fallback: {
      id: "boro-newham",
      name: "Newham CPZ (town-centre streets)",
      sched: [{ days: MF, from: "08:00", to: "18:30" }],
      ratePence: 380,
      maxStayHours: 4,
    },
  },
  {
    borough: "Brent",
    displayName: "Brent",
    zoneIdPrefix: "brt",
    src: "https://www.brent.gov.uk/parking-and-permits",
    fallback: {
      id: "boro-brent",
      name: "Brent CPZ (town-centre streets)",
      sched: [{ days: MF, from: "08:00", to: "18:30" }],
      ratePence: 380,
      maxStayHours: 4,
    },
  },
  {
    borough: "Ealing",
    displayName: "Ealing",
    zoneIdPrefix: "eal",
    src: "https://www.ealing.gov.uk/parking",
    fallback: {
      id: "boro-ealing",
      name: "Ealing CPZ (town-centre streets)",
      sched: [{ days: MF, from: "08:30", to: "18:30" }],
      ratePence: 360,
      maxStayHours: 4,
    },
  },

  // --- Outer London: control is patchy / town-centre only --------------------
  {
    borough: "Barnet",
    displayName: "Barnet",
    zoneIdPrefix: "brn",
    src: "https://www.barnet.gov.uk/parking",
    fallback: {
      id: "boro-barnet",
      name: "Barnet CPZ (town-centre streets)",
      sched: [{ days: MF, from: "10:00", to: "12:00" }],
      ratePence: 320,
      maxStayHours: 4,
    },
  },
  {
    borough: "Enfield",
    displayName: "Enfield",
    zoneIdPrefix: "enf",
    src: "https://www.enfield.gov.uk/services/parking",
    fallback: {
      id: "boro-enfield",
      name: "Enfield CPZ (town-centre streets)",
      sched: [{ days: MF, from: "08:30", to: "18:30" }],
      ratePence: 320,
      maxStayHours: 4,
    },
  },
  {
    borough: "Waltham Forest",
    displayName: "Waltham Forest",
    zoneIdPrefix: "wfr",
    src: "https://www.walthamforest.gov.uk/parking-and-permits",
    fallback: {
      id: "boro-walthamforest",
      name: "Waltham Forest CPZ (town-centre streets)",
      sched: [{ days: MF, from: "08:30", to: "18:30" }],
      ratePence: 320,
      maxStayHours: 4,
    },
  },
  {
    borough: "Redbridge",
    displayName: "Redbridge",
    zoneIdPrefix: "rdb",
    src: "https://www.redbridge.gov.uk/parking/",
    fallback: {
      id: "boro-redbridge",
      name: "Redbridge CPZ (town-centre streets)",
      sched: [{ days: MF, from: "08:00", to: "18:30" }],
      ratePence: 300,
      maxStayHours: 4,
    },
  },
  {
    borough: "Barking and Dagenham",
    displayName: "Barking & Dagenham",
    zoneIdPrefix: "bkd",
    src: "https://www.lbbd.gov.uk/parking-and-red-routes",
    fallback: {
      id: "boro-barkingdagenham",
      name: "Barking & Dagenham CPZ (town-centre streets)",
      sched: [{ days: MF, from: "08:00", to: "18:30" }],
      ratePence: 300,
      maxStayHours: 4,
    },
  },
  {
    borough: "Havering",
    displayName: "Havering",
    zoneIdPrefix: "hav",
    src: "https://www.havering.gov.uk/parking",
    fallback: {
      id: "boro-havering",
      name: "Havering CPZ (town-centre streets)",
      sched: [{ days: MF, from: "08:00", to: "18:00" }],
      ratePence: 300,
      maxStayHours: 4,
    },
  },
  {
    borough: "Greenwich",
    displayName: "Greenwich",
    zoneIdPrefix: "grn",
    src: "https://www.royalgreenwich.gov.uk/parking",
    fallback: {
      id: "boro-greenwich",
      name: "Greenwich CPZ (town-centre streets)",
      sched: [{ days: MF, from: "08:30", to: "18:30" }],
      ratePence: 340,
      maxStayHours: 4,
    },
  },
  {
    borough: "Bexley",
    displayName: "Bexley",
    zoneIdPrefix: "bex",
    src: "https://www.bexley.gov.uk/services/parking-and-roads/parking",
    fallback: {
      id: "boro-bexley",
      name: "Bexley CPZ (town-centre streets)",
      sched: [{ days: MF, from: "08:00", to: "18:30" }],
      ratePence: 280,
      maxStayHours: 4,
    },
  },
  {
    borough: "Bromley",
    displayName: "Bromley",
    zoneIdPrefix: "brm",
    src: "https://www.bromley.gov.uk/parking",
    fallback: {
      id: "boro-bromley",
      name: "Bromley CPZ (town-centre streets)",
      sched: [{ days: MF, from: "08:30", to: "18:30" }],
      ratePence: 300,
      maxStayHours: 4,
    },
  },
  {
    borough: "Croydon",
    displayName: "Croydon",
    zoneIdPrefix: "crd",
    src: "https://www.croydon.gov.uk/parking",
    fallback: {
      id: "boro-croydon",
      name: "Croydon CPZ (town-centre streets)",
      sched: [{ days: MF, from: "08:30", to: "18:30" }],
      ratePence: 320,
      maxStayHours: 4,
    },
  },
  {
    borough: "Sutton",
    displayName: "Sutton",
    zoneIdPrefix: "stn",
    src: "https://www.sutton.gov.uk/w/parking",
    fallback: {
      id: "boro-sutton",
      name: "Sutton CPZ (town-centre streets)",
      sched: [{ days: MF, from: "08:30", to: "18:30" }],
      ratePence: 300,
      maxStayHours: 4,
    },
  },
  {
    borough: "Merton",
    displayName: "Merton",
    zoneIdPrefix: "mrt",
    src: "https://www.merton.gov.uk/parking-roads-and-travel/parking",
    fallback: {
      id: "boro-merton",
      name: "Merton CPZ (town-centre streets)",
      sched: [{ days: MF, from: "08:30", to: "18:30" }],
      ratePence: 320,
      maxStayHours: 4,
    },
  },
  {
    borough: "Kingston upon Thames",
    displayName: "Kingston upon Thames",
    zoneIdPrefix: "kng",
    src: "https://www.kingston.gov.uk/parking",
    fallback: {
      id: "boro-kingston",
      name: "Kingston CPZ (town-centre streets)",
      sched: [{ days: MF, from: "08:30", to: "18:30" }],
      ratePence: 340,
      maxStayHours: 4,
    },
    portal: {
      kind: "arcgis",
      cpz: {
        // RB Kingston "Controlled Parking Zones (INSPIRE)" feature service; one
        // combined TimeOfOperation string carries code + hours + area name.
        layerUrl:
          "https://services2.arcgis.com/HGokIRbN2kiuIxW5/arcgis/rest/services/CPZ_updated/FeatureServer/0",
        hoursFields: ["TimeOfOperation"],
        ratePence: 340,
        maxStayHours: 4,
      },
    },
  },
  {
    borough: "Richmond upon Thames",
    displayName: "Richmond upon Thames",
    zoneIdPrefix: "rch",
    src: "https://www.richmond.gov.uk/services/parking",
    fallback: {
      id: "boro-richmond",
      name: "Richmond CPZ (town-centre streets)",
      sched: [{ days: MF, from: "09:00", to: "17:00" }],
      ratePence: 360,
      maxStayHours: 4,
    },
  },
  {
    borough: "Hounslow",
    displayName: "Hounslow",
    zoneIdPrefix: "hns",
    src: "https://www.hounslow.gov.uk/parking",
    fallback: {
      id: "boro-hounslow",
      name: "Hounslow CPZ (town-centre streets)",
      sched: [{ days: MF, from: "08:30", to: "18:30" }],
      ratePence: 320,
      maxStayHours: 4,
    },
  },
  {
    borough: "Hillingdon",
    displayName: "Hillingdon",
    zoneIdPrefix: "hil",
    src: "https://www.hillingdon.gov.uk/parking",
    fallback: {
      id: "boro-hillingdon",
      name: "Hillingdon CPZ (town-centre streets)",
      sched: [{ days: MF, from: "08:00", to: "18:30" }],
      ratePence: 300,
      maxStayHours: 4,
    },
  },
  {
    borough: "Harrow",
    displayName: "Harrow",
    zoneIdPrefix: "hrw",
    src: "https://www.harrow.gov.uk/parking-roads",
    fallback: {
      id: "boro-harrow",
      name: "Harrow CPZ (town-centre streets)",
      sched: [{ days: MF, from: "08:30", to: "18:30" }],
      ratePence: 320,
      maxStayHours: 4,
    },
    portal: {
      kind: "arcgis",
      cpz: {
        // Harrow self-hosted ArcGIS Server (esriJSON only — the connector's
        // f=json fallback handles it). Joined layer, so fields are qualified;
        // CPZ = zone code, TIMES = free-text control hours.
        layerUrl:
          "https://mapping.harrow.gov.uk/server/rest/services/Public/Transport_and_Streets_2/MapServer/1",
        hoursFields: ["TRANSPORTATION_USER.CPZ_ZONE_BOUNDARIES.TIMES"],
        zoneField: "TRANSPORTATION_USER.CPZ_ZONE_BOUNDARIES.CPZ",
        ratePence: 320,
        maxStayHours: 4,
      },
    },
  },
];
