/**
 * Common duty stations. When a feed names one of these cities without a
 * country (e.g. "Duty station: Geneva"), the country is filled in from
 * this list because the city is unambiguous. Cities not listed here are
 * still shown exactly as the feed gives them.
 */
export const DUTY_STATIONS: Record<string, string> = {
  "Geneva": "CH", "Bern": "CH", "Zurich": "CH", "Basel": "CH", "Lausanne": "CH",
  "New York": "US", "Washington": "US", "Washington, DC": "US", "Washington DC": "US", "Atlanta": "US", "Boston": "US",
  "Nairobi": "KE", "Kisumu": "KE", "Dadaab": "KE", "Kakuma": "KE",
  "Vienna": "AT", "Rome": "IT", "Turin": "IT", "Brindisi": "IT", "Florence": "IT",
  "Paris": "FR", "Lyon": "FR", "Strasbourg": "FR",
  "Brussels": "BE", "Luxembourg City": "LU", "The Hague": "NL", "Amsterdam": "NL",
  "Copenhagen": "DK", "Stockholm": "SE", "Oslo": "NO", "Helsinki": "FI",
  "Bonn": "DE", "Berlin": "DE", "Hamburg": "DE", "Frankfurt": "DE", "Munich": "DE",
  "London": "GB", "Madrid": "ES", "Valencia": "ES", "Lisbon": "PT", "Budapest": "HU", "Warsaw": "PL", "Prague": "CZ",
  "Istanbul": "TR", "Ankara": "TR", "Gaziantep": "TR",
  "Bangkok": "TH", "Manila": "PH", "Kuala Lumpur": "MY", "Jakarta": "ID", "Hanoi": "VN", "Ho Chi Minh City": "VN",
  "Phnom Penh": "KH", "Vientiane": "LA", "Yangon": "MM", "Dhaka": "BD", "Cox's Bazar": "BD", "Cox’s Bazar": "BD",
  "Kathmandu": "NP", "New Delhi": "IN", "Delhi": "IN", "Mumbai": "IN", "Colombo": "LK", "Islamabad": "PK", "Karachi": "PK",
  "Kabul": "AF", "Tashkent": "UZ", "Almaty": "KZ", "Astana": "KZ", "Bishkek": "KG", "Dushanbe": "TJ", "Ashgabat": "TM",
  "Beijing": "CN", "Tokyo": "JP", "Seoul": "KR", "Incheon": "KR", "Singapore": "SG", "Ulaanbaatar": "MN",
  "Suva": "FJ", "Apia": "WS", "Port Moresby": "PG", "Canberra": "AU", "Sydney": "AU",
  "Amman": "JO", "Beirut": "LB", "Damascus": "SY", "Baghdad": "IQ", "Erbil": "IQ", "Cairo": "EG", "Tunis": "TN",
  "Rabat": "MA", "Algiers": "DZ", "Tripoli": "LY", "Sana'a": "YE", "Sanaa": "YE", "Aden": "YE", "Riyadh": "SA",
  "Doha": "QA", "Dubai": "AE", "Abu Dhabi": "AE", "Kuwait City": "KW", "Jerusalem": "PS", "Ramallah": "PS", "Gaza City": "PS",
  "Tehran": "IR", "Baku": "AZ", "Tbilisi": "GE", "Yerevan": "AM", "Kyiv": "UA", "Kiev": "UA", "Chisinau": "MD",
  "Belgrade": "RS", "Sarajevo": "BA", "Pristina": "XK", "Skopje": "MK", "Tirana": "AL", "Podgorica": "ME",
  "Addis Ababa": "ET", "Juba": "SS", "Khartoum": "SD", "Port Sudan": "SD", "Mogadishu": "SO", "Hargeisa": "SO",
  "Kampala": "UG", "Kigali": "RW", "Bujumbura": "BI", "Dar es Salaam": "TZ", "Dodoma": "TZ", "Arusha": "TZ",
  "Kinshasa": "CD", "Goma": "CD", "Bukavu": "CD", "Lubumbashi": "CD", "Brazzaville": "CG", "Bangui": "CF",
  "Yaoundé": "CM", "Yaounde": "CM", "Douala": "CM", "N'Djamena": "TD", "Ndjamena": "TD", "Niamey": "NE",
  "Bamako": "ML", "Ouagadougou": "BF", "Dakar": "SN", "Abidjan": "CI", "Accra": "GH", "Lomé": "TG", "Lome": "TG",
  "Cotonou": "BJ", "Abuja": "NG", "Lagos": "NG", "Maiduguri": "NG", "Freetown": "SL", "Monrovia": "LR",
  "Conakry": "GN", "Bissau": "GW", "Banjul": "GM", "Nouakchott": "MR", "Libreville": "GA", "Malabo": "GQ",
  "Luanda": "AO", "Lusaka": "ZM", "Harare": "ZW", "Lilongwe": "MW", "Maputo": "MZ", "Antananarivo": "MG",
  "Pretoria": "ZA", "Johannesburg": "ZA", "Cape Town": "ZA", "Gaborone": "BW", "Windhoek": "NA", "Maseru": "LS", "Mbabane": "SZ",
  "Panama City": "PA", "Bogotá": "CO", "Bogota": "CO", "Lima": "PE", "Quito": "EC", "La Paz": "BO", "Santiago": "CL",
  "Buenos Aires": "AR", "Montevideo": "UY", "Asunción": "PY", "Asuncion": "PY", "Brasília": "BR", "Brasilia": "BR",
  "Mexico City": "MX", "Guatemala City": "GT", "Tegucigalpa": "HN", "San Salvador": "SV", "Managua": "NI",
  "San José": "CR", "Port-au-Prince": "HT", "Santo Domingo": "DO", "Havana": "CU",
  "Caracas": "VE", "Bridgetown": "BB", "Port of Spain": "TT", "Paramaribo": "SR",
  "Montreal": "CA", "Ottawa": "CA", "Toronto": "CA",
};
