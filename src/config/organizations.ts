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
  /**
   * Where every one of its posts is (an organization on one site): used only for a listing that
   * names no place at all. Never for an organization with offices elsewhere.
   */
  site?: { country: string; city: string };
};

export const KNOWN_ORGS: KnownOrg[] = [
  { name: "United Nations Secretariat", short: "UN", type: "UN system", aliases: ["United Nations", "UN Secretariat", "Inspira", "UN Careers"], domains: ["careers.un.org", "inspira.un.org"] },
  { name: "UNICEF", short: "UNICEF", type: "UN system", aliases: ["United Nations Children's Fund", "United Nations Childrens Fund", "UN Children's Fund"], domains: ["unicef.org"] },
  { name: "UNDP", short: "UNDP", type: "UN system", aliases: ["United Nations Development Programme"], domains: ["undp.org"] },
  { name: "World Health Organization", short: "WHO", type: "UN system", aliases: ["WHO"], domains: ["who.int"] },
  { name: "Pan American Health Organization", short: "PAHO", type: "UN system", aliases: ["PAHO"], domains: ["paho.org"] },
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
  { name: "World Bank Group", short: "World Bank", badge: "WB", type: "International financial institution", aliases: ["World Bank", "The World Bank", "IFC", "International Finance Corporation"], domains: ["worldbank.org", "ifc.org", "worldbankgroup.csod.com"] },
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
  { name: "Alliance of Bioversity International and CIAT", type: "International organization", aliases: ["Bioversity International", "Alliance Bioversity-CIAT", "CIAT"], domains: ["alliancebioversityciat.org", "bioversityinternational.org", "bioversityinternational.zohorecruit.eu"] },
  { name: "Transparency International", type: "NGO", aliases: ["Transparency International (Secretariat)", "Transparency International Secretariat"], domains: ["transparency.org", "transparency.softgarden.io"] },
  { name: "OSCE", short: "OSCE", type: "International organization", aliases: ["Organization for Security and Co-operation in Europe"], domains: ["osce.org"] },
  { name: "Council of Europe", badge: "CoE", type: "International organization", domains: ["coe.int"] },
  { name: "European Commission", type: "EU institution", aliases: ["EC"], domains: ["commission.europa.eu"] },
  { name: "European Central Bank", short: "ECB", site: { country: "DE", city: "Frankfurt am Main" }, type: "EU institution", aliases: ["ECB"], domains: ["ecb.europa.eu"] },
  { name: "European External Action Service", short: "EEAS", type: "EU institution", aliases: ["EEAS"], domains: ["eeas.europa.eu"] },
  { name: "EPSO (EU institutions)", short: "EPSO", type: "EU institution", aliases: ["EPSO", "European Personnel Selection Office"], domains: ["epso.europa.eu", "eu-careers.europa.eu"] },
  // Red Cross and Red Crescent: their emblem is protected (Geneva Conventions), so no logo is ever
  // fetched, stored or served for them or any national society (isLogoProtected in src/lib/feeds/logos.ts).
  { name: "International Committee of the Red Cross", short: "ICRC", type: "International organization", aliases: ["ICRC"], domains: ["icrc.org"] },
  { name: "IFRC", short: "IFRC", type: "International organization", aliases: ["International Federation of Red Cross and Red Crescent Societies"], domains: ["ifrc.org"] },
  { name: "Médecins Sans Frontières", short: "MSF", type: "NGO", aliases: ["MSF", "Medecins Sans Frontieres", "Doctors Without Borders", "Médecins Sans Frontières en Suisse", "MSF Switzerland", "Médecins Sans Frontières Suisse", "Médicos Sin Fronteras"], domains: ["msf.org"] },
  { name: "Save the Children", type: "NGO", domains: ["savethechildren.net", "savethechildren.org"] },
  { name: "International Rescue Committee", short: "IRC", type: "NGO", aliases: ["IRC"], domains: ["rescue.org", "theirc.wd1.myworkdayjobs.com"] },
  { name: "Norwegian Refugee Council", short: "NRC", type: "NGO", aliases: ["NRC"], domains: ["nrc.no"] },
  { name: "Oxfam", type: "NGO", aliases: ["Oxfam International"], domains: ["oxfam.org"] },
  { name: "CARE International", short: "CARE", type: "NGO", aliases: ["CARE"], domains: ["care-international.org", "care.org"] },
  { name: "Danish Refugee Council", short: "DRC", type: "NGO", domains: ["drc.ngo"] },
  { name: "Mercy Corps", type: "NGO", domains: ["mercycorps.org"] },
  { name: "World Vision", type: "NGO", aliases: ["World Vision International"], domains: ["wvi.org", "worldvision.org"] },
  { name: "ACTED", short: "ACTED", type: "NGO", aliases: ["Agency for Technical Cooperation and Development"], domains: ["acted.org"] },
  { name: "IMPACT Initiatives", short: "IMPACT", type: "NGO", aliases: ["IMPACT"], domains: ["impact-initiatives.org"] },
  { name: "CERN", short: "CERN", site: { country: "CH", city: "Geneva" }, type: "International organization", aliases: ["European Organization for Nuclear Research"], domains: ["cern.ch", "careers.cern"] },
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
  { name: "World Resources Institute", short: "WRI", type: "NGO", aliases: ["WRI"], domains: ["wri.org"] },
  { name: "International Union for Conservation of Nature", short: "IUCN", type: "International organization", aliases: ["IUCN", "International Union for Conservation of Nature (IUCN)"], domains: ["iucn.org"] },
  { name: "European Molecular Biology Laboratory", short: "EMBL", type: "International organization", aliases: ["EMBL", "EMBL-EBI"], domains: ["embl.org", "ebi.ac.uk"] },
  { name: "International Medical Corps", short: "IMC", type: "NGO", aliases: ["IMC"], domains: ["internationalmedicalcorps.org"] },
  { name: "Street Child", type: "NGO", domains: ["street-child.org", "street-child.co.uk"] },
  { name: "Heifer International", short: "Heifer", type: "NGO", domains: ["heifer.org"] },
  { name: "Management Sciences for Health", short: "MSH", type: "NGO", aliases: ["MSH"], domains: ["msh.org"] },
  { name: "Plan International", type: "NGO", domains: ["plan-international.org"] },
  // Employers seen without a name in their feed items (Nov 2026 data audit): recognised by their recruitment site or the name opening the title.
  { name: "ICAO", short: "ICAO", type: "UN system", aliases: ["International Civil Aviation Organization"], domains: ["icao.int"] },
  { name: "Catholic Relief Services", short: "CRS", type: "NGO", aliases: ["CRS"], domains: ["crs.org", "eipn.fa.us2.oraclecloud.com"] },
  { name: "The Global Fund", short: "Global Fund", type: "International organization", aliases: ["Global Fund", "The Global Fund to Fight AIDS, Tuberculosis and Malaria", "Global Fund to Fight AIDS, Tuberculosis and Malaria"], domains: ["theglobalfund.org", "theglobalfund.wd1.myworkdayjobs.com"] },
  { name: "Gates Foundation", short: "Gates Foundation", badge: "BMGF", type: "NGO", aliases: ["BMGF", "Bill & Melinda Gates Foundation", "Bill and Melinda Gates Foundation"], domains: ["gatesfoundation.org", "gatesfoundation.wd1.myworkdayjobs.com"] },
  { name: "Clinton Health Access Initiative", short: "CHAI", type: "NGO", aliases: ["CHAI"], domains: ["clintonhealthaccess.org", "careers-chai.icims.com"] },
  { name: "GIZ", short: "GIZ", type: "International organization", aliases: ["Deutsche Gesellschaft für Internationale Zusammenarbeit"], domains: ["giz.de"] },
  { name: "Agence Française de Développement", short: "AFD", type: "International financial institution", aliases: ["AFD", "French Development Agency"], domains: ["afd.fr", "afd.csod.com"] },
  { name: "ICMPD", short: "ICMPD", type: "International organization", aliases: ["International Centre for Migration Policy Development"], domains: ["icmpd.org"] },
  { name: "EUROCONTROL", short: "EUROCONTROL", badge: "ECTL", type: "International organization", domains: ["eurocontrol.int"] },
  { name: "Frontex", short: "Frontex", type: "EU institution", aliases: ["European Border and Coast Guard Agency"], domains: ["frontex.europa.eu"] },
  { name: "EUMETSAT", short: "EUMETSAT", badge: "EUMSAT", site: { country: "DE", city: "Darmstadt" }, type: "International organization", domains: ["eumetsat.int", "eumetsat.jobbase.io"] },
  { name: "Action Against Hunger", type: "NGO", badge: "ACF", aliases: ["Action contre la Faim", "Accion contra el Hambre", "ACF"], domains: ["actionagainsthunger.org", "actioncontrelafaim.org", "acf-e.org"] },
  { name: "Solidarités International", type: "NGO", badge: "SI", aliases: ["Solidarites International", "Solidarités"], domains: ["solidarites.org"] },
  { name: "RTI International", short: "RTI", type: "NGO", aliases: ["RTI"], domains: ["rti.org"] },
  { name: "PATH", short: "PATH", type: "NGO", domains: ["path.org", "path.wd1.myworkdayjobs.com"] },
  { name: "NATO Support and Procurement Agency", short: "NSPA", type: "International organization", aliases: ["NSPA"], domains: ["nspa.nato.int", "nspa-nato.career.emply.com"] },
  { name: "Fusion for Energy", short: "F4E", type: "EU institution", aliases: ["F4E"], domains: ["fusionforenergy.europa.eu", "f4e-jobs.gestmax.eu"] },
  { name: "Terre des hommes", short: "Tdh", type: "NGO", aliases: ["Tdh", "Terre des hommes Foundation"], domains: ["tdh.org", "tdh.ch"] },
  { name: "CIMMYT", short: "CIMMYT", type: "International organization", aliases: ["International Maize and Wheat Improvement Center"], domains: ["cimmyt.org"] },
  { name: "Humanity & Inclusion", short: "HI", type: "NGO", aliases: ["Handicap International", "Humanity and Inclusion"], domains: ["hi.org", "handicap-international.org"] },
  { name: "Amref Health Africa", short: "Amref", type: "NGO", aliases: ["AMREF", "Amref"], domains: ["amref.org"] },
  { name: "Partners In Health", short: "PIH", type: "NGO", aliases: ["PIH"], domains: ["pih.org"] },
  { name: "WWF", short: "WWF", type: "NGO", aliases: ["World Wide Fund for Nature", "World Wildlife Fund"], domains: ["wwf.org", "worldwildlife.org", "panda.org"] },
  { name: "Children's Investment Fund Foundation", short: "CIFF", type: "NGO", aliases: ["CIFF"], domains: ["ciff.org"] },
  { name: "CGIAR", short: "CGIAR", type: "International organization", domains: ["cgiar.org"] },
];
