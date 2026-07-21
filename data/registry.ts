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
  /**
   * Descriptive-area column to append to the zone code, for boroughs whose code
   * column repeats across areas (RBKC: Control = "Control 1" for three
   * different named areas). Only read when `zoneField` is set — without it the
   * area is parsed out of the hours text instead.
   */
  areaField?: string;
  /**
   * Parse each `hoursFields` column on its own and concatenate the results,
   * instead of space-joining the columns into one string first.
   *
   * Required for boroughs that put one complete day+time clause per column
   * (RBKC: Control_1 = "8:30am - 10:00pm Monday to Friday", Control_2 =
   * "8:30am - 6:30pm Saturday"). Joining those produces a string with several
   * time-first clauses in a row, which parseScheduleText mis-reads — it pairs a
   * later clause's end time with an earlier clause's days and emits a phantom
   * window. Joining stays the default because it is what a borough splitting a
   * single clause across columns needs (H&F: DAYS + TIME_).
   */
  hoursPerField?: boolean;
  /**
   * Hand-verified hours by zone code, for layers that publish the zone
   * geometry but no hours columns at all (Tower Hamlets). Same contract as the
   * Socrata portal's `verifiedHours`: cite the source in the borough entry, and
   * only use hours read off the council's own page.
   */
  verifiedHours?: Record<string, CpzHours[]>;
  /**
   * Zone codes whose control extends on event days, for boroughs that state
   * this in prose rather than in the layer. Emitted as `zones.events.json`
   * records so rule 12 can warn — the engine still never applies them itself.
   */
  verifiedEvents?: Record<string, { venue: string; rawText: string }>;
  ratePence: number;
  maxStayHours: number;
  /**
   * Some boroughs flag event-day zones with a status column rather than writing
   * the extra hours into the schedule text (Newham: CPZ_Status = "Event Day
   * Parking Zone" around the London Stadium). Those zones' published hours are
   * their *regular* hours, so without this the engine would read a quiet
   * Saturday as free and recommend parking there on a match day.
   */
  eventStatusField?: string;
  /** Values of `eventStatusField` that mark an event-day zone. */
  eventStatusMatch?: RegExp;
  /** Venue whose fixtures trigger the control — the column names no venue. */
  eventVenue?: string;
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

/**
 * How to import a borough's CPZ layer from a **GeoServer** WFS — the backend
 * behind a council's own map viewer (Hackney). Serves WGS84 GeoJSON directly,
 * so no reprojection is needed, unlike the iShare GML path.
 */
export interface GeoserverCpzPortal {
  /** Layer name including workspace, e.g. "parking:controlled_parking_zone". */
  typeName: string;
  zoneField: string;
  /** Attribute(s) carrying the control hours. */
  hoursFields: string[];
  /**
   * Splits one hours attribute holding several clauses (Hackney joins them
   * with "<br>"). Each clause is then parsed on its own — joining them first
   * makes the parser pair one clause's times with another's days.
   */
  hoursSplit?: RegExp;
  ratePence: number;
  maxStayHours: number;
}

export interface GeoserverPortal {
  kind: "geoserver";
  /** GeoServer root, e.g. "https://map2.hackney.gov.uk/geoserver". */
  baseUrl: string;
  cpz?: GeoserverCpzPortal;
}

export type Portal = SocrataPortal | ArcgisPortal | IsharePortal | GeoserverPortal;

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

const ALLDAY = { from: "00:00", to: "23:59" };

/**
 * Tower Hamlets hours, read off towerhamlets.gov.uk "Parking zones and
 * controlled parking times" (July 2026). The borough's ArcGIS layer publishes
 * the 16 mini-zone polygons with a code and nothing else, so the hours are
 * hand-transcribed and keyed by that code.
 *
 * Three zones are split by street inside one polygon, and the layer gives us no
 * way to tell which side of the split a point is on. Each takes the UNION of
 * both published patterns — over-stating when control applies. That direction is
 * the safe one: rule 7 says the costly error is calling a controlled kerb free,
 * and rule 9 already refuses to let these clear a restriction. The narrower
 * reading is recoverable (a user sees a free bay listed as controlled); the
 * wider one is a £130 PCN.
 *  - A6: "Mon-Sun 8.30am-10pm in RESIDENT bays west of Brick Lane, otherwise
 *    Mon-Fri 8.30am-7pm; Sun 8.30am-2pm" -> Mon-Sun 08:30-22:00.
 *  - B3: Chrisp St area Mon-Sat, rest Mon-Fri (both 8.30-5.30) -> Mon-Sat.
 *  - C2: Trinity Square Mon-Sat + Sun, rest Mon-Fri -> Mon-Sat + Sun.
 */
const TOWER_HAMLETS_VERIFIED_HOURS: Record<string, CpzHours[]> = {
  A1: [{ days: MF, from: "08:30", to: "17:30" }, { days: [0], from: "08:30", to: "14:00" }],
  A2: [{ days: MF, from: "08:30", to: "17:30" }, { days: [0], from: "08:30", to: "14:00" }],
  A3: [{ days: MS, from: "08:30", to: "17:30" }],
  A4: [{ days: MF, from: "08:30", to: "17:30" }],
  // "Monday from midnight to 7pm, Tuesday and Wednesday from 8.30am to 7pm,
  // Thursday from 8.30am to midnight and all-day Friday, Saturday, and Sunday."
  A5: [
    { days: [1], from: "00:00", to: "19:00" },
    { days: [2, 3], from: "08:30", to: "19:00" },
    { days: [4], from: "08:30", to: "23:59" },
    { days: [5, 6, 0], ...ALLDAY },
  ],
  A6: [{ days: [0, 1, 2, 3, 4, 5, 6], from: "08:30", to: "22:00" }],
  B1: [{ days: MS, from: "08:30", to: "17:30" }],
  B2: [{ days: MF, from: "08:30", to: "17:30" }],
  B3: [{ days: MS, from: "08:30", to: "17:30" }],
  // Sunday control is EVENT DAYS ONLY — see TOWER_HAMLETS_VERIFIED_EVENTS.
  B4: [{ days: MS, from: "08:30", to: "19:30" }],
  C1: [{ days: MF, from: "08:30", to: "17:30" }],
  C2: [{ days: MS, from: "08:30", to: "17:30" }, { days: [0], from: "08:30", to: "14:00" }],
  C3: [{ days: MF, from: "08:30", to: "17:30" }],
  C4: [{ days: MF, from: "08:30", to: "17:30" }],
  D1: [{ days: MF, from: "08:30", to: "17:30" }],
  D2: [{ days: MF, from: "08:30", to: "17:30" }],
};

/**
 * B4 gains a Sunday control on London Stadium event days. Its regular hours
 * (Mon-Sat) leave Sunday clear, so without this record the engine would call a
 * B4 Sunday free on a match day — exactly the rule 12 failure mode.
 */
const TOWER_HAMLETS_VERIFIED_EVENTS: Record<string, { venue: string; rawText: string }> = {
  B4: {
    venue: "London Stadium",
    rawText:
      "Event days only sun 8.30am to 7.30pm — event dates are posted on the CPZ " +
      "entry signs and the London Stadium website (towerhamlets.gov.uk, July 2026)",
  },
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
    src: "https://www.hackney.gov.uk/parking-streets-and-transport/where-park/parking-zones",
    fallback: {
      id: "boro-hackney",
      name: "Hackney CPZ (borough-wide)",
      sched: [{ days: MF, from: "08:30", to: "18:30" }],
      ratePence: 500,
      maxStayHours: 4,
    },
    portal: {
      kind: "geoserver",
      // The GeoServer behind the council's own map at map2.hackney.gov.uk. It
      // is in no open-data catalogue — the URL came out of the map's JS bundle.
      baseUrl: "https://map2.hackney.gov.uk/geoserver",
      cpz: {
        typeName: "parking:controlled_parking_zone",
        zoneField: "zone",
        hoursFields: ["controlled_hours"],
        // "Mon-Fri 8.30am-6.30pm<br>Sat 8.30am-1.30pm<br>Emirates Stadium events"
        hoursSplit: /<br\s*\/?>/i,
        ratePence: 500,
        maxStayHours: 4,
      },
    },
  },
  {
    borough: "Tower Hamlets",
    displayName: "Tower Hamlets",
    zoneIdPrefix: "twh",
    src: "https://www.towerhamlets.gov.uk/lgnl/transport_and_streets/Parking/parking_zones_and_charges/Parking_zones.aspx",
    fallback: {
      id: "boro-towerhamlets",
      name: "Tower Hamlets CPZ (borough-wide)",
      sched: [{ days: MF, from: "08:30", to: "17:30" }],
      ratePence: 450,
      maxStayHours: 4,
    },
    portal: {
      kind: "arcgis",
      cpz: {
        // "Parking Permit Mini Zones" — the 16 mini-zone polygons behind the
        // borough's own parking map. Geometry and a ZONE_CODE only, so the
        // hours come from the transcribed table above rather than the layer.
        layerUrl:
          "https://services1.arcgis.com/KZuCGRSe2K5BiG1Z/arcgis/rest/services/Parking_Permit_Mini_Zones_view/FeatureServer/159",
        zoneField: "ZONE_CODE",
        hoursFields: [],
        verifiedHours: TOWER_HAMLETS_VERIFIED_HOURS,
        verifiedEvents: TOWER_HAMLETS_VERIFIED_EVENTS,
        ratePence: 450,
        maxStayHours: 4,
      },
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
    portal: {
      kind: "arcgis",
      cpz: {
        // RBKC "Residents Parking Control" on the council's own ArcGIS server
        // (the same box that serves the LBHF layer). One day+time clause per
        // column — Control_1 weekdays, Control_2 Saturday, Control_3 Sunday —
        // hence hoursPerField. `Control` ("Control 1".."Control 8") is the code
        // and repeats across areas, so Area_Name disambiguates.
        //
        // Layer 4 ("Controlled Parking Zones - SYL") is deliberately NOT used:
        // single-yellow-line zones carry no hours columns at all.
        layerUrl: "https://www.rbkc.gov.uk/arcgis/rest/services/RBKC/INSPIRE/MapServer/13",
        zoneField: "Control",
        areaField: "Area_Name",
        hoursFields: ["Control_1", "Control_2", "Control_3"],
        hoursPerField: true,
        ratePence: 650,
        maxStayHours: 4,
      },
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
    src: "https://www.southwark.gov.uk/parking-streets-and-transport/parking",
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
    portal: {
      kind: "arcgis",
      cpz: {
        // LB Newham CPZ layer (ArcGIS Online). NAME = zone name, TIMES = free-text
        // hours ("10am - 12 Noon (Mon-Fri)"). CPZ_Status flags the five London
        // Stadium event-day zones, whose published TIMES are regular hours only.
        layerUrl:
          "https://services1.arcgis.com/trOdpHvvP7HrTfdb/arcgis/rest/services/Controlled_Parking_Zones/FeatureServer/0",
        hoursFields: ["TIMES"],
        zoneField: "NAME",
        ratePence: 380,
        maxStayHours: 4,
        eventStatusField: "CPZ_Status",
        eventStatusMatch: /event\s*day/i,
        eventVenue: "London Stadium",
      },
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
    portal: {
      kind: "arcgis",
      cpz: {
        // LB Merton "CPZ_Boundaries" (ArcGIS Online, layer 5 of the parking
        // service). Zone_Label = "Zone 2F", Operation_Summary = "Mon-Sat 8:30am
        // - 6:30pm" — one combined string the shared parser reads directly.
        layerUrl:
          "https://services-eu1.arcgis.com/lDzXrGJF6LKIhYUB/arcgis/rest/services/Controlled_Parking_Zone_Boundaries/FeatureServer/5",
        hoursFields: ["Operation_Summary"],
        zoneField: "Zone_Label",
        ratePence: 320,
        maxStayHours: 4,
      },
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
    portal: {
      kind: "arcgis",
      cpz: {
        // "Car Park, CPZ and Railways" layer 4 — the borough's parking-management
        // schemes. `Zones` is the short code (H1, HY1, E), `Label_2` the area,
        // `Times` a time-first string ("9am to 5pm - Mon to Sat").
        //
        // 15 of 84 rows have a blank `Times`; those parse to null and correctly
        // land on the indicative fallback rather than claiming hours we don't
        // have. A few rows append "Max stay 2 hours" to the times text — the
        // parser ignores the tail, and maxStayHours here stays the borough
        // default, so don't read this zone's max stay as authoritative.
        layerUrl:
          "https://services1.arcgis.com/vBu1s2ZA7rxzmHBD/arcgis/rest/services/Car_Park__CPZ_and_Railways_WFL1/FeatureServer/4",
        zoneField: "Zones",
        areaField: "Label_2",
        hoursFields: ["Times"],
        ratePence: 300,
        maxStayHours: 4,
      },
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
