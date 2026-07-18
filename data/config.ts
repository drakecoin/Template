import type { SchedEntry } from "@kerbside/engine";

/**
 * Borough-level CPZ configuration joined onto real boundary polygons by the ETL.
 *
 * These are deliberately conservative generalisations for boroughs whose kerbside
 * is (almost) entirely controlled: hours are the borough's most common weekday
 * pattern and every record is flagged unverified, because individual zones within
 * a borough vary. Zone-level records in the engine's curated dataset always take
 * priority over these fallbacks. Sources are the council parking pages.
 */
export interface BoroughConfig {
  /** Feature name in the boroughs GeoJSON. */
  borough: string;
  id: string;
  name: string;
  sched: SchedEntry[];
  ratePence: number;
  maxStayHours: number;
  src: string;
}

const MF = [1, 2, 3, 4, 5];
const MS = [1, 2, 3, 4, 5, 6];

export const BOROUGH_CONFIG: BoroughConfig[] = [
  {
    borough: "Islington",
    id: "boro-islington",
    name: "Islington CPZ (borough-wide)",
    sched: [
      { days: MF, from: "08:30", to: "18:30" },
      { days: [6], from: "08:30", to: "13:30" },
    ],
    ratePence: 650,
    maxStayHours: 4,
    src: "https://www.islington.gov.uk/parking/parking-restrictions/controlled-parking-zones",
  },
  {
    borough: "Camden",
    id: "boro-camden",
    name: "Camden CPZ (borough-wide)",
    sched: [
      { days: MF, from: "08:30", to: "18:30" },
      { days: [6], from: "08:30", to: "13:30" },
    ],
    ratePence: 700,
    maxStayHours: 4,
    src: "https://www.camden.gov.uk/controlled-parking-zones",
  },
  {
    borough: "Westminster",
    id: "boro-westminster",
    name: "Westminster CPZ (borough-wide)",
    sched: [{ days: MS, from: "08:30", to: "18:30" }],
    ratePence: 890,
    maxStayHours: 4,
    src: "https://www.westminster.gov.uk/parking/parking-zones-and-prices",
  },
  {
    borough: "City of London",
    id: "boro-city",
    name: "City of London CPZ",
    sched: [{ days: MF, from: "08:30", to: "18:30" }],
    ratePence: 670,
    maxStayHours: 4,
    src: "https://www.cityoflondon.gov.uk/services/parking",
  },
  {
    borough: "Hackney",
    id: "boro-hackney",
    name: "Hackney CPZ (borough-wide)",
    sched: [{ days: MF, from: "08:30", to: "18:30" }],
    ratePence: 500,
    maxStayHours: 4,
    src: "https://hackney.gov.uk/parking-zones",
  },
  {
    borough: "Tower Hamlets",
    id: "boro-towerhamlets",
    name: "Tower Hamlets CPZ (borough-wide)",
    sched: [{ days: MF, from: "08:30", to: "17:30" }],
    ratePence: 450,
    maxStayHours: 4,
    src: "https://www.towerhamlets.gov.uk/lgnl/transport_and_streets/parking/parking.aspx",
  },
  {
    borough: "Kensington and Chelsea",
    id: "boro-rbkc",
    name: "Kensington & Chelsea CPZ (borough-wide)",
    sched: [{ days: MS, from: "08:30", to: "18:30" }],
    ratePence: 650,
    maxStayHours: 4,
    src: "https://www.rbkc.gov.uk/parking/parking-zones-and-bays",
  },
  {
    borough: "Hammersmith and Fulham",
    id: "boro-hf",
    name: "Hammersmith & Fulham CPZ (most streets)",
    sched: [{ days: MF, from: "09:00", to: "17:00" }],
    ratePence: 480,
    maxStayHours: 4,
    src: "https://www.lbhf.gov.uk/parking",
  },
  {
    borough: "Lambeth",
    id: "boro-lambeth",
    name: "Lambeth CPZ (most streets)",
    sched: [{ days: MF, from: "08:30", to: "18:30" }],
    ratePence: 440,
    maxStayHours: 4,
    src: "https://www.lambeth.gov.uk/parking-transport-streets/parking/controlled-parking-zones-cpzs",
  },
  {
    borough: "Southwark",
    id: "boro-southwark",
    name: "Southwark CPZ (most streets)",
    sched: [{ days: MF, from: "08:30", to: "18:30" }],
    ratePence: 460,
    maxStayHours: 3,
    src: "https://www.southwark.gov.uk/parking/parking-zones",
  },
  {
    borough: "Wandsworth",
    id: "boro-wandsworth",
    name: "Wandsworth CPZ (most streets)",
    sched: [{ days: MF, from: "09:00", to: "17:00" }],
    ratePence: 450,
    maxStayHours: 4,
    src: "https://www.wandsworth.gov.uk/parking/",
  },
];
