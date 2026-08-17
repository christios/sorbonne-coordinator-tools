import { Command } from "cmdk";
import { ChevronsUpDown, Search } from "lucide-react";
import { Popover } from "radix-ui";
import { useMemo, useState } from "react";

type CountryPhoneCode = { code: string; country: string; iso: string };

function FlagIcon({ iso }: { iso: string }) {
  const offset = 0x1f1e6 - 65;
  const normalized = iso.toLocaleUpperCase();
  return <span aria-hidden>{String.fromCodePoint(normalized.charCodeAt(0) + offset, normalized.charCodeAt(1) + offset)}</span>;
}

// Kept in sync with Zenith's CountryCodeCombobox.
const COUNTRY_PHONE_CODES: CountryPhoneCode[] = [
  ["+93", "Afghanistan", "AF"], ["+355", "Albania", "AL"], ["+213", "Algeria", "DZ"], ["+376", "Andorra", "AD"], ["+244", "Angola", "AO"], ["+54", "Argentina", "AR"], ["+374", "Armenia", "AM"], ["+61", "Australia", "AU"], ["+43", "Austria", "AT"], ["+994", "Azerbaijan", "AZ"],
  ["+973", "Bahrain", "BH"], ["+880", "Bangladesh", "BD"], ["+375", "Belarus", "BY"], ["+32", "Belgium", "BE"], ["+501", "Belize", "BZ"], ["+229", "Benin", "BJ"], ["+975", "Bhutan", "BT"], ["+591", "Bolivia", "BO"], ["+387", "Bosnia", "BA"], ["+267", "Botswana", "BW"], ["+55", "Brazil", "BR"], ["+673", "Brunei", "BN"], ["+359", "Bulgaria", "BG"], ["+226", "Burkina Faso", "BF"], ["+257", "Burundi", "BI"],
  ["+855", "Cambodia", "KH"], ["+237", "Cameroon", "CM"], ["+1", "Canada / USA", "US"], ["+238", "Cape Verde", "CV"], ["+236", "Central African Rep.", "CF"], ["+235", "Chad", "TD"], ["+56", "Chile", "CL"], ["+86", "China", "CN"], ["+57", "Colombia", "CO"], ["+269", "Comoros", "KM"], ["+242", "Congo", "CG"], ["+243", "Congo (DRC)", "CD"], ["+506", "Costa Rica", "CR"], ["+385", "Croatia", "HR"], ["+53", "Cuba", "CU"], ["+357", "Cyprus", "CY"], ["+420", "Czech Republic", "CZ"],
  ["+45", "Denmark", "DK"], ["+253", "Djibouti", "DJ"], ["+593", "Ecuador", "EC"], ["+20", "Egypt", "EG"], ["+503", "El Salvador", "SV"], ["+240", "Equatorial Guinea", "GQ"], ["+291", "Eritrea", "ER"], ["+372", "Estonia", "EE"], ["+268", "Eswatini", "SZ"], ["+251", "Ethiopia", "ET"], ["+679", "Fiji", "FJ"], ["+358", "Finland", "FI"], ["+33", "France", "FR"],
  ["+241", "Gabon", "GA"], ["+220", "Gambia", "GM"], ["+995", "Georgia", "GE"], ["+49", "Germany", "DE"], ["+233", "Ghana", "GH"], ["+30", "Greece", "GR"], ["+299", "Greenland", "GL"], ["+502", "Guatemala", "GT"], ["+224", "Guinea", "GN"], ["+245", "Guinea-Bissau", "GW"], ["+592", "Guyana", "GY"], ["+509", "Haiti", "HT"], ["+504", "Honduras", "HN"], ["+852", "Hong Kong", "HK"], ["+36", "Hungary", "HU"],
  ["+354", "Iceland", "IS"], ["+91", "India", "IN"], ["+62", "Indonesia", "ID"], ["+98", "Iran", "IR"], ["+964", "Iraq", "IQ"], ["+353", "Ireland", "IE"], ["+972", "Israel", "IL"], ["+39", "Italy", "IT"], ["+225", "Ivory Coast", "CI"], ["+81", "Japan", "JP"], ["+962", "Jordan", "JO"], ["+7", "Kazakhstan / Russia", "KZ"], ["+254", "Kenya", "KE"], ["+965", "Kuwait", "KW"], ["+996", "Kyrgyzstan", "KG"],
  ["+856", "Laos", "LA"], ["+371", "Latvia", "LV"], ["+961", "Lebanon", "LB"], ["+266", "Lesotho", "LS"], ["+231", "Liberia", "LR"], ["+218", "Libya", "LY"], ["+423", "Liechtenstein", "LI"], ["+370", "Lithuania", "LT"], ["+352", "Luxembourg", "LU"], ["+853", "Macau", "MO"], ["+261", "Madagascar", "MG"], ["+265", "Malawi", "MW"], ["+60", "Malaysia", "MY"], ["+960", "Maldives", "MV"], ["+223", "Mali", "ML"], ["+356", "Malta", "MT"], ["+222", "Mauritania", "MR"], ["+230", "Mauritius", "MU"], ["+52", "Mexico", "MX"], ["+373", "Moldova", "MD"], ["+377", "Monaco", "MC"], ["+976", "Mongolia", "MN"], ["+382", "Montenegro", "ME"], ["+212", "Morocco", "MA"], ["+258", "Mozambique", "MZ"], ["+95", "Myanmar", "MM"],
  ["+264", "Namibia", "NA"], ["+977", "Nepal", "NP"], ["+31", "Netherlands", "NL"], ["+64", "New Zealand", "NZ"], ["+505", "Nicaragua", "NI"], ["+227", "Niger", "NE"], ["+234", "Nigeria", "NG"], ["+389", "North Macedonia", "MK"], ["+850", "North Korea", "KP"], ["+47", "Norway", "NO"], ["+968", "Oman", "OM"], ["+92", "Pakistan", "PK"], ["+970", "Palestine", "PS"], ["+507", "Panama", "PA"], ["+675", "Papua New Guinea", "PG"], ["+595", "Paraguay", "PY"], ["+51", "Peru", "PE"], ["+63", "Philippines", "PH"], ["+48", "Poland", "PL"], ["+351", "Portugal", "PT"], ["+974", "Qatar", "QA"], ["+40", "Romania", "RO"], ["+250", "Rwanda", "RW"],
  ["+966", "Saudi Arabia", "SA"], ["+221", "Senegal", "SN"], ["+381", "Serbia", "RS"], ["+248", "Seychelles", "SC"], ["+232", "Sierra Leone", "SL"], ["+65", "Singapore", "SG"], ["+421", "Slovakia", "SK"], ["+386", "Slovenia", "SI"], ["+252", "Somalia", "SO"], ["+27", "South Africa", "ZA"], ["+82", "South Korea", "KR"], ["+34", "Spain", "ES"], ["+94", "Sri Lanka", "LK"], ["+249", "Sudan", "SD"], ["+597", "Suriname", "SR"], ["+46", "Sweden", "SE"], ["+41", "Switzerland", "CH"], ["+963", "Syria", "SY"],
  ["+886", "Taiwan", "TW"], ["+992", "Tajikistan", "TJ"], ["+255", "Tanzania", "TZ"], ["+66", "Thailand", "TH"], ["+228", "Togo", "TG"], ["+676", "Tonga", "TO"], ["+216", "Tunisia", "TN"], ["+90", "Turkey", "TR"], ["+993", "Turkmenistan", "TM"], ["+256", "Uganda", "UG"], ["+380", "Ukraine", "UA"], ["+971", "UAE", "AE"], ["+44", "United Kingdom", "GB"], ["+598", "Uruguay", "UY"], ["+998", "Uzbekistan", "UZ"], ["+58", "Venezuela", "VE"], ["+84", "Vietnam", "VN"], ["+967", "Yemen", "YE"], ["+260", "Zambia", "ZM"], ["+263", "Zimbabwe", "ZW"],
].map(([code, country, iso]) => ({ code, country, iso }));

export function CountryCodeCombobox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = COUNTRY_PHONE_CODES.find((country) => country.code === value);
  const filteredCountries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return normalizedQuery ? COUNTRY_PHONE_CODES.filter((country) => `${country.country} ${country.code}`.toLocaleLowerCase().includes(normalizedQuery)) : COUNTRY_PHONE_CODES;
  }, [query]);

  return <Popover.Root open={open} onOpenChange={setOpen}><Popover.Trigger asChild><button type="button" role="combobox" aria-expanded={open} aria-label="Country code" className="inline-flex h-10 w-30 shrink-0 items-center justify-between rounded-md border border-[#b7bec8] bg-white px-3 text-sm font-normal text-[#344054] hover:bg-[#f7f8fa] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]"><span className="flex items-center gap-1.5 truncate">{selected ? <FlagIcon iso={selected.iso} /> : null}{selected?.code ?? value}</span><ChevronsUpDown size={14} aria-hidden className="ml-1 shrink-0 opacity-50" /></button></Popover.Trigger><Popover.Portal><Popover.Content align="start" sideOffset={4} className="z-50 w-64 overflow-hidden rounded-md border border-[#d9dee7] bg-white p-0 shadow-lg"><Command label="Search country" shouldFilter={false}><div className="flex h-10 items-center gap-2 border-b border-[#e5e7eb] px-3"><Search size={16} aria-hidden className="shrink-0 text-[#667085]" /><Command.Input placeholder="Search country..." value={query} onValueChange={setQuery} className="h-full w-full bg-transparent text-sm outline-none placeholder:text-[#98a2b3]" /></div><Command.List className="max-h-72 overflow-y-auto p-1">{filteredCountries.length ? <Command.Group>{filteredCountries.map((country) => <Command.Item key={`${country.code}-${country.country}`} value={`${country.country} ${country.code}`} onSelect={() => { onChange(country.code); setOpen(false); setQuery(""); }} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm text-[#344054] aria-selected:bg-[#eef3f8]"><FlagIcon iso={country.iso} /><span className="flex-1 truncate">{country.country}</span><span className="text-xs text-[#667085]">{country.code}</span></Command.Item>)}</Command.Group> : <Command.Empty className="px-3 py-5 text-center text-sm text-[#667085]">No country found.</Command.Empty>}</Command.List></Command></Popover.Content></Popover.Portal></Popover.Root>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function parsePhoneValue(value: string) {
  const match = [...COUNTRY_PHONE_CODES].sort((left, right) => right.code.length - left.code.length).find((country) => value.trim().startsWith(country.code));
  return { countryCode: match?.code ?? "+1", localNumber: match ? value.trim().slice(match.code.length).trim() : value };
}
