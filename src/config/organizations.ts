/**
 * Known organizations. Used ONLY to recognise and tidy up names that
 * already appear in a feed (e.g. "United Nations Children's Fund" and
 * "UNICEF" become one organization), and to recognise an employer from
 * the domain of the official vacancy link. It never adds an
 * organization to a job on its own.
 *
 * Organizations not in this list are still imported, using the name
 * found in the feed. Add entries here whenever you see duplicates.
 */
export type OrgType =
  | "UN system"
  | "International financial institution"
  | "EU institution"
  | "International organization"
  | "NGO";

export type KnownOrg = {
  /** Display name. */
  name: string;
  /** Short name or acronym, if commonly used. */
  short?: string;
  /** Text of the organization's badge (a monogram, at most 6 characters) when the short name doesn't fit or there is none. */
  badge?: string;
  type: OrgType;
  /** Other spellings seen in feeds (case-insensitive, exact match after trimming). */
  aliases?: string[];
  /** Hostnames of the organization's own career sites (subdomains match too). */
  domains?: string[];
};

export const KNOWN_ORGS: KnownOrg[] = [
  { name: "United Nations Secretariat", short: "UN", type: "UN system", aliases: ["United Nations", "UN Secretariat", "Inspira", "UN Careers"], domains: ["careers.un.org", "inspira.un.org"] },
  { name: "UNICEF", short: "UNICEF", type: "UN system", aliases: ["United Nations Children's Fund", "United Nations Childrens Fund", "UN Children's Fund"], domains: ["unicef.org"] },
  { name: "UNDP", short: "UNDP", type: "UN system", aliases: ["United Nations Development Programme"], domains: ["undp.org"] },
  { name: "World Health Organization", short: "WHO", type: "UN system", aliases: ["WHO"], domains: ["who.int"] },
  { name: "UNOPS", short: "UNOPS", type: "UN system", aliases: ["United Nations Office for Project Services"], domains: ["unops.org"] },
  { name: "UNHCR", short: "UNHCR", type: "UN system", aliases: ["United Nations High Commissioner for Refugees", "UN Refugee Agency", "The UN Refugee Agency", "ACNUR"], domains: ["unhcr.org"] },
  { name: "World Food Programme", short: "WFP", type: "UN system", aliases: ["WFP", "United Nations World Food Programme"], domains: ["wfp.org"] },
  { name: "FAO", short: "FAO", type: "UN system", aliases: ["Food and Agriculture Organization", "Food and Agriculture Organization of the United Nations"], domains: ["fao.org"] },
  { name: "International Labour Organization", short: "ILO", type: "UN system", aliases: ["ILO"], domains: ["ilo.org"] },
  { name: "International Organization for Migration", short: "IOM", type: "UN system", aliases: ["IOM", "UN Migration", "OIM"], domains: ["iom.int", "fa-evlj-saasfaprod1.fa.ocs.oraclecloud.com"] },
  { name: "UNFPA", short: "UNFPA", type: "UN system", aliases: ["United Nations Population Fund"], domains: ["unfpa.org"] },
  { name: "UN Women", short: "UN Women", badge: "UNW", type: "UN system", aliases: ["United Nations Entity for Gender Equality and the Empowerment of Women"], domains: ["unwomen.org"] },
  { name: "UNESCO", short: "UNESCO", type: "UN system", aliases: ["United Nations Educational, Scientific and Cultural Organization"], domains: ["unesco.org"] },
  { name: "UNEP", short: "UNEP", type: "UN system", aliases: ["United Nations Environment Programme", "UN Environment Programme"], domains: ["unep.org"] },
  { name: "UN-Habitat", short: "UN-Habitat", type: "UN system", aliases: ["United Nations Human Settlements Programme"], domains: ["unhabitat.org"] },
  { name: "OCHA", short: "OCHA", type: "UN system", aliases: ["UN OCHA", "United Nations Office for the Coordination of Humanitarian Affairs"], domains: ["unocha.org"] },
  { name: "UNIDO", short: "UNIDO", type: "UN system", aliases: ["United Nations Industrial Development Organization"], domains: ["unido.org"] },
  { name: "UNRWA", short: "UNRWA", type: "UN system", aliases: ["United Nations Relief and Works Agency for Palestine Refugees in the Near East"], domains: ["unrwa.org"] },
  { name: "UNODC", short: "UNODC", type: "UN system", aliases: ["United Nations Office on Drugs and Crime"], domains: ["unodc.org"] },
  { name: "UNAIDS", short: "UNAIDS", type: "UN system", aliases: ["Joint United Nations Programme on HIV/AIDS"], domains: ["unaids.org"] },
  { name: "UN Volunteers", short: "UNV", type: "UN system", aliases: ["UNV", "United Nations Volunteers"], domains: ["unv.org", "app.unv.org"] },
  { name: "ITU", short: "ITU", type: "UN system", aliases: ["International Telecommunication Union"], domains: ["itu.int"] },
  { name: "IAEA", short: "IAEA", type: "UN system", aliases: ["International Atomic Energy Agency"], domains: ["iaea.org"] },
  { name: "WIPO", short: "WIPO", type: "UN system", aliases: ["World Intellectual Property Organization"], domains: ["wipo.int"] },
  { name: "IFAD", short: "IFAD", type: "UN system", aliases: ["International Fund for Agricultural Development"], domains: ["ifad.org"] },
  { name: "World Bank Group", short: "World Bank", badge: "WB", type: "International financial institution", aliases: ["World Bank", "The World Bank", "IFC", "International Finance Corporation"], domains: ["worldbank.org", "ifc.org"] },
  { name: "International Monetary Fund", short: "IMF", type: "International financial institution", aliases: ["IMF"], domains: ["imf.org"] },
  { name: "Asian Development Bank", short: "ADB", type: "International financial institution", aliases: ["ADB"], domains: ["adb.org"] },
  { name: "African Development Bank", short: "AfDB", type: "International financial institution", aliases: ["AfDB", "African Development Bank Group"], domains: ["afdb.org"] },
  { name: "Inter-American Development Bank", short: "IDB", type: "International financial institution", aliases: ["IDB", "IADB", "IDB Group", "Inter-American Development Bank Group"], domains: ["iadb.org"] },
  { name: "EBRD", short: "EBRD", type: "International financial institution", aliases: ["European Bank for Reconstruction and Development"], domains: ["ebrd.com"] },
  { name: "European Investment Bank", short: "EIB", type: "International financial institution", aliases: ["EIB"], domains: ["eib.org"] },
  { name: "INTERPOL", short: "INTERPOL", badge: "IPOL", type: "International organization", aliases: ["International Criminal Police Organization", "ICPO-INTERPOL"], domains: ["interpol.int", "209400.jobs2web.com"] },
  { name: "OECD", short: "OECD", type: "International organization", aliases: ["Organisation for Economic Co-operation and Development", "Organization for Economic Cooperation and Development"], domains: ["oecd.org"] },
  { name: "NATO", short: "NATO", type: "International organization", aliases: ["North Atlantic Treaty Organization", "NATO Communications and Information Agency", "NCIA"], domains: ["nato.int", "ncia.nato.int"] },
  { name: "European Space Agency", short: "ESA", type: "International organization", aliases: ["ESA"], domains: ["esa.int"] },
  { name: "Alliance of Bioversity International and CIAT", type: "International organization", aliases: ["Bioversity International", "Alliance Bioversity-CIAT", "CIAT"], domains: ["alliancebioversityciat.org", "bioversityinternational.org"] },
  { name: "Transparency International", type: "NGO", aliases: ["Transparency International (Secretariat)", "Transparency International Secretariat"], domains: ["transparency.org"] },
  { name: "OSCE", short: "OSCE", type: "International organization", aliases: ["Organization for Security and Co-operation in Europe"], domains: ["osce.org"] },
  { name: "Council of Europe", badge: "CoE", type: "International organization", domains: ["coe.int"] },
  { name: "European Commission", type: "EU institution", aliases: ["EC"], domains: ["commission.europa.eu"] },
  { name: "European Central Bank", short: "ECB", type: "EU institution", aliases: ["ECB"], domains: ["ecb.europa.eu"] },
  { name: "European External Action Service", short: "EEAS", type: "EU institution", aliases: ["EEAS"], domains: ["eeas.europa.eu"] },
  { name: "EPSO (EU institutions)", short: "EPSO", type: "EU institution", aliases: ["EPSO", "European Personnel Selection Office"], domains: ["epso.europa.eu", "eu-careers.europa.eu"] },
  // Red Cross and Red Crescent: their emblem is protected (Geneva Conventions), so no logo is ever
  // fetched, stored or served for them or any national society (isLogoProtected in src/lib/feeds/logos.ts).
  { name: "International Committee of the Red Cross", short: "ICRC", type: "International organization", aliases: ["ICRC"], domains: ["icrc.org"] },
  { name: "IFRC", short: "IFRC", type: "International organization", aliases: ["International Federation of Red Cross and Red Crescent Societies"], domains: ["ifrc.org"] },
  { name: "Médecins Sans Frontières", short: "MSF", type: "NGO", aliases: ["MSF", "Medecins Sans Frontieres", "Doctors Without Borders", "Médecins Sans Frontières en Suisse", "MSF Switzerland", "Médecins Sans Frontières Suisse", "Médicos Sin Fronteras"], domains: ["msf.org"] },
  { name: "Save the Children", type: "NGO", domains: ["savethechildren.net", "savethechildren.org"] },
  { name: "International Rescue Committee", short: "IRC", type: "NGO", aliases: ["IRC"], domains: ["rescue.org"] },
  { name: "Norwegian Refugee Council", short: "NRC", type: "NGO", aliases: ["NRC"], domains: ["nrc.no"] },
  { name: "Oxfam", type: "NGO", aliases: ["Oxfam International"], domains: ["oxfam.org"] },
  { name: "CARE International", short: "CARE", type: "NGO", aliases: ["CARE"], domains: ["care-international.org", "care.org"] },
  { name: "Danish Refugee Council", short: "DRC", type: "NGO", domains: ["drc.ngo"] },
  { name: "Mercy Corps", type: "NGO", domains: ["mercycorps.org"] },
  { name: "World Vision", type: "NGO", aliases: ["World Vision International"], domains: ["wvi.org", "worldvision.org"] },
  { name: "ACTED", short: "ACTED", type: "NGO", aliases: ["Agency for Technical Cooperation and Development"], domains: ["acted.org"] },
  { name: "IMPACT Initiatives", short: "IMPACT", type: "NGO", aliases: ["IMPACT"], domains: ["impact-initiatives.org"] },
  { name: "CERN", short: "CERN", type: "International organization", aliases: ["European Organization for Nuclear Research"], domains: ["cern.ch", "careers.cern"] },
  { name: "International Livestock Research Institute", short: "ILRI", type: "International organization", aliases: ["ILRI"], domains: ["ilri.org"] },
  { name: "FHI 360", short: "FHI 360", type: "NGO", aliases: ["FHI360", "Family Health International"], domains: ["fhi360.org"] },
  { name: "Jhpiego", short: "Jhpiego", type: "NGO", domains: ["jhpiego.org"] },
  { name: "ACLED", short: "ACLED", type: "NGO", aliases: ["Armed Conflict Location & Event Data"], domains: ["acleddata.com", "acleddata.bamboohr.com"] },
  { name: "Concern Worldwide", short: "Concern", type: "NGO", aliases: ["Concern"], domains: ["concern.net"] },
  { name: "Médecins du Monde", short: "MdM", type: "NGO", aliases: ["Medecins du Monde", "Doctors of the World"], domains: ["medecinsdumonde.org"] },
  { name: "Drugs for Neglected Diseases initiative", short: "DNDi", type: "NGO", aliases: ["DNDi"], domains: ["dndi.org"] },
  { name: "Blue Ventures", type: "NGO", domains: ["blueventures.org"] },
  { name: "Syrian Center for Media and Freedom of Expression", short: "SCM", type: "NGO" },
  { name: "Pacific Community", short: "SPC", type: "International organization", aliases: ["SPC", "Secretariat of the Pacific Community"], domains: ["spc.int"] },
  { name: "Asian Disaster Preparedness Center", short: "ADPC", type: "International organization", aliases: ["ADPC"], domains: ["adpc.net"] },
  { name: "Geneva Centre for Security Sector Governance", short: "DCAF", type: "International organization", aliases: ["DCAF"], domains: ["dcaf.ch"] },
];
