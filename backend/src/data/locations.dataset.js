/*
 * The global location dataset.
 *
 * A data file, not a wall of INSERT statements. The importer in
 * `schema.locations.js` reads this and upserts it, so replacing this file with
 * a fuller export — a GeoNames dump, a commercial dataset — needs no code
 * change at all. That is the point of the split, and the reason the shapes
 * below are deliberately dull.
 *
 * Coverage is honest about itself: India is complete (all 28 states and 8
 * union territories, with real cities in each) because it is where the product
 * is sold today. Every other country has its top-level divisions and its
 * principal cities — enough to sign up and be billed correctly, and enough to
 * prove the cascade works, but not a substitute for a full gazetteer.
 *
 * Rows are arrays rather than objects purely for size; the importer names the
 * columns, so nothing downstream depends on the order but that one function.
 */

/* name, iso2, iso3, phone code, currency code, currency name, timezone */
export const COUNTRIES = [
  ['India', 'IN', 'IND', '+91', 'INR', 'Indian Rupee', 'Asia/Kolkata'],
  ['United States', 'US', 'USA', '+1', 'USD', 'US Dollar', 'America/New_York'],
  ['United Kingdom', 'GB', 'GBR', '+44', 'GBP', 'Pound Sterling', 'Europe/London'],
  ['United Arab Emirates', 'AE', 'ARE', '+971', 'AED', 'UAE Dirham', 'Asia/Dubai'],
  ['Canada', 'CA', 'CAN', '+1', 'CAD', 'Canadian Dollar', 'America/Toronto'],
  ['Australia', 'AU', 'AUS', '+61', 'AUD', 'Australian Dollar', 'Australia/Sydney'],
  ['Singapore', 'SG', 'SGP', '+65', 'SGD', 'Singapore Dollar', 'Asia/Singapore'],
  ['Malaysia', 'MY', 'MYS', '+60', 'MYR', 'Malaysian Ringgit', 'Asia/Kuala_Lumpur'],
  ['Indonesia', 'ID', 'IDN', '+62', 'IDR', 'Indonesian Rupiah', 'Asia/Jakarta'],
  ['Philippines', 'PH', 'PHL', '+63', 'PHP', 'Philippine Peso', 'Asia/Manila'],
  ['Thailand', 'TH', 'THA', '+66', 'THB', 'Thai Baht', 'Asia/Bangkok'],
  ['Vietnam', 'VN', 'VNM', '+84', 'VND', 'Vietnamese Dong', 'Asia/Ho_Chi_Minh'],
  ['Bangladesh', 'BD', 'BGD', '+880', 'BDT', 'Bangladeshi Taka', 'Asia/Dhaka'],
  ['Sri Lanka', 'LK', 'LKA', '+94', 'LKR', 'Sri Lankan Rupee', 'Asia/Colombo'],
  ['Nepal', 'NP', 'NPL', '+977', 'NPR', 'Nepalese Rupee', 'Asia/Kathmandu'],
  ['Pakistan', 'PK', 'PAK', '+92', 'PKR', 'Pakistani Rupee', 'Asia/Karachi'],
  ['Saudi Arabia', 'SA', 'SAU', '+966', 'SAR', 'Saudi Riyal', 'Asia/Riyadh'],
  ['Qatar', 'QA', 'QAT', '+974', 'QAR', 'Qatari Riyal', 'Asia/Qatar'],
  ['Kuwait', 'KW', 'KWT', '+965', 'KWD', 'Kuwaiti Dinar', 'Asia/Kuwait'],
  ['Oman', 'OM', 'OMN', '+968', 'OMR', 'Omani Rial', 'Asia/Muscat'],
  ['Bahrain', 'BH', 'BHR', '+973', 'BHD', 'Bahraini Dinar', 'Asia/Bahrain'],
  ['South Africa', 'ZA', 'ZAF', '+27', 'ZAR', 'South African Rand', 'Africa/Johannesburg'],
  ['Nigeria', 'NG', 'NGA', '+234', 'NGN', 'Nigerian Naira', 'Africa/Lagos'],
  ['Kenya', 'KE', 'KEN', '+254', 'KES', 'Kenyan Shilling', 'Africa/Nairobi'],
  ['Egypt', 'EG', 'EGY', '+20', 'EGP', 'Egyptian Pound', 'Africa/Cairo'],
  ['Germany', 'DE', 'DEU', '+49', 'EUR', 'Euro', 'Europe/Berlin'],
  ['France', 'FR', 'FRA', '+33', 'EUR', 'Euro', 'Europe/Paris'],
  ['Spain', 'ES', 'ESP', '+34', 'EUR', 'Euro', 'Europe/Madrid'],
  ['Italy', 'IT', 'ITA', '+39', 'EUR', 'Euro', 'Europe/Rome'],
  ['Netherlands', 'NL', 'NLD', '+31', 'EUR', 'Euro', 'Europe/Amsterdam'],
  ['Ireland', 'IE', 'IRL', '+353', 'EUR', 'Euro', 'Europe/Dublin'],
  ['Portugal', 'PT', 'PRT', '+351', 'EUR', 'Euro', 'Europe/Lisbon'],
  ['Poland', 'PL', 'POL', '+48', 'PLN', 'Polish Zloty', 'Europe/Warsaw'],
  ['Turkey', 'TR', 'TUR', '+90', 'TRY', 'Turkish Lira', 'Europe/Istanbul'],
  ['Brazil', 'BR', 'BRA', '+55', 'BRL', 'Brazilian Real', 'America/Sao_Paulo'],
  ['Mexico', 'MX', 'MEX', '+52', 'MXN', 'Mexican Peso', 'America/Mexico_City'],
  ['Argentina', 'AR', 'ARG', '+54', 'ARS', 'Argentine Peso', 'America/Argentina/Buenos_Aires'],
  ['Chile', 'CL', 'CHL', '+56', 'CLP', 'Chilean Peso', 'America/Santiago'],
  ['Japan', 'JP', 'JPN', '+81', 'JPY', 'Japanese Yen', 'Asia/Tokyo'],
  ['South Korea', 'KR', 'KOR', '+82', 'KRW', 'South Korean Won', 'Asia/Seoul'],
  ['China', 'CN', 'CHN', '+86', 'CNY', 'Chinese Yuan', 'Asia/Shanghai'],
  ['Hong Kong', 'HK', 'HKG', '+852', 'HKD', 'Hong Kong Dollar', 'Asia/Hong_Kong'],
  ['New Zealand', 'NZ', 'NZL', '+64', 'NZD', 'New Zealand Dollar', 'Pacific/Auckland'],
  ['Switzerland', 'CH', 'CHE', '+41', 'CHF', 'Swiss Franc', 'Europe/Zurich'],
  ['Sweden', 'SE', 'SWE', '+46', 'SEK', 'Swedish Krona', 'Europe/Stockholm'],
  ['Norway', 'NO', 'NOR', '+47', 'NOK', 'Norwegian Krone', 'Europe/Oslo'],
  ['Denmark', 'DK', 'DNK', '+45', 'DKK', 'Danish Krone', 'Europe/Copenhagen']
];

/* iso2 -> [ name, code, type ] */
export const STATES = {
  IN: [
    ['Andhra Pradesh', 'AP', 'State'], ['Arunachal Pradesh', 'AR', 'State'],
    ['Assam', 'AS', 'State'], ['Bihar', 'BR', 'State'], ['Chhattisgarh', 'CG', 'State'],
    ['Goa', 'GA', 'State'], ['Gujarat', 'GJ', 'State'], ['Haryana', 'HR', 'State'],
    ['Himachal Pradesh', 'HP', 'State'], ['Jharkhand', 'JH', 'State'],
    ['Karnataka', 'KA', 'State'], ['Kerala', 'KL', 'State'],
    ['Madhya Pradesh', 'MP', 'State'], ['Maharashtra', 'MH', 'State'],
    ['Manipur', 'MN', 'State'], ['Meghalaya', 'ML', 'State'], ['Mizoram', 'MZ', 'State'],
    ['Nagaland', 'NL', 'State'], ['Odisha', 'OD', 'State'], ['Punjab', 'PB', 'State'],
    ['Rajasthan', 'RJ', 'State'], ['Sikkim', 'SK', 'State'], ['Tamil Nadu', 'TN', 'State'],
    ['Telangana', 'TG', 'State'], ['Tripura', 'TR', 'State'],
    ['Uttar Pradesh', 'UP', 'State'], ['Uttarakhand', 'UK', 'State'],
    ['West Bengal', 'WB', 'State'],
    ['Andaman and Nicobar Islands', 'AN', 'Union Territory'],
    ['Chandigarh', 'CH', 'Union Territory'],
    ['Dadra and Nagar Haveli and Daman and Diu', 'DH', 'Union Territory'],
    ['Delhi', 'DL', 'Union Territory'],
    ['Jammu and Kashmir', 'JK', 'Union Territory'],
    ['Ladakh', 'LA', 'Union Territory'],
    ['Lakshadweep', 'LD', 'Union Territory'],
    ['Puducherry', 'PY', 'Union Territory']
  ],
  US: [
    ['Alabama', 'AL', 'State'], ['Alaska', 'AK', 'State'], ['Arizona', 'AZ', 'State'],
    ['Arkansas', 'AR', 'State'], ['California', 'CA', 'State'], ['Colorado', 'CO', 'State'],
    ['Connecticut', 'CT', 'State'], ['Delaware', 'DE', 'State'],
    ['District of Columbia', 'DC', 'Federal District'], ['Florida', 'FL', 'State'],
    ['Georgia', 'GA', 'State'], ['Hawaii', 'HI', 'State'], ['Idaho', 'ID', 'State'],
    ['Illinois', 'IL', 'State'], ['Indiana', 'IN', 'State'], ['Iowa', 'IA', 'State'],
    ['Kansas', 'KS', 'State'], ['Kentucky', 'KY', 'State'], ['Louisiana', 'LA', 'State'],
    ['Maine', 'ME', 'State'], ['Maryland', 'MD', 'State'], ['Massachusetts', 'MA', 'State'],
    ['Michigan', 'MI', 'State'], ['Minnesota', 'MN', 'State'], ['Mississippi', 'MS', 'State'],
    ['Missouri', 'MO', 'State'], ['Montana', 'MT', 'State'], ['Nebraska', 'NE', 'State'],
    ['Nevada', 'NV', 'State'], ['New Hampshire', 'NH', 'State'], ['New Jersey', 'NJ', 'State'],
    ['New Mexico', 'NM', 'State'], ['New York', 'NY', 'State'],
    ['North Carolina', 'NC', 'State'], ['North Dakota', 'ND', 'State'],
    ['Ohio', 'OH', 'State'], ['Oklahoma', 'OK', 'State'], ['Oregon', 'OR', 'State'],
    ['Pennsylvania', 'PA', 'State'], ['Rhode Island', 'RI', 'State'],
    ['South Carolina', 'SC', 'State'], ['South Dakota', 'SD', 'State'],
    ['Tennessee', 'TN', 'State'], ['Texas', 'TX', 'State'], ['Utah', 'UT', 'State'],
    ['Vermont', 'VT', 'State'], ['Virginia', 'VA', 'State'], ['Washington', 'WA', 'State'],
    ['West Virginia', 'WV', 'State'], ['Wisconsin', 'WI', 'State'], ['Wyoming', 'WY', 'State']
  ],
  AE: [
    ['Abu Dhabi', 'AZ', 'Emirate'], ['Dubai', 'DU', 'Emirate'], ['Sharjah', 'SH', 'Emirate'],
    ['Ajman', 'AJ', 'Emirate'], ['Umm Al Quwain', 'UQ', 'Emirate'],
    ['Ras Al Khaimah', 'RK', 'Emirate'], ['Fujairah', 'FU', 'Emirate']
  ],
  GB: [
    ['England', 'ENG', 'Country'], ['Scotland', 'SCT', 'Country'],
    ['Wales', 'WLS', 'Country'], ['Northern Ireland', 'NIR', 'Country']
  ],
  CA: [
    ['Alberta', 'AB', 'Province'], ['British Columbia', 'BC', 'Province'],
    ['Manitoba', 'MB', 'Province'], ['New Brunswick', 'NB', 'Province'],
    ['Newfoundland and Labrador', 'NL', 'Province'], ['Nova Scotia', 'NS', 'Province'],
    ['Ontario', 'ON', 'Province'], ['Prince Edward Island', 'PE', 'Province'],
    ['Quebec', 'QC', 'Province'], ['Saskatchewan', 'SK', 'Province'],
    ['Northwest Territories', 'NT', 'Territory'], ['Nunavut', 'NU', 'Territory'],
    ['Yukon', 'YT', 'Territory']
  ],
  AU: [
    ['New South Wales', 'NSW', 'State'], ['Victoria', 'VIC', 'State'],
    ['Queensland', 'QLD', 'State'], ['South Australia', 'SA', 'State'],
    ['Western Australia', 'WA', 'State'], ['Tasmania', 'TAS', 'State'],
    ['Australian Capital Territory', 'ACT', 'Territory'],
    ['Northern Territory', 'NT', 'Territory']
  ],
  SG: [['Singapore', 'SG', 'Region']],
  HK: [['Hong Kong', 'HK', 'Region']],
  MY: [
    ['Johor', 'JHR', 'State'], ['Kedah', 'KDH', 'State'], ['Kelantan', 'KTN', 'State'],
    ['Melaka', 'MLK', 'State'], ['Negeri Sembilan', 'NSN', 'State'], ['Pahang', 'PHG', 'State'],
    ['Penang', 'PNG', 'State'], ['Perak', 'PRK', 'State'], ['Perlis', 'PLS', 'State'],
    ['Sabah', 'SBH', 'State'], ['Sarawak', 'SWK', 'State'], ['Selangor', 'SGR', 'State'],
    ['Terengganu', 'TRG', 'State'], ['Kuala Lumpur', 'KUL', 'Federal Territory'],
    ['Labuan', 'LBN', 'Federal Territory'], ['Putrajaya', 'PJY', 'Federal Territory']
  ],
  DE: [
    ['Baden-Württemberg', 'BW', 'State'], ['Bavaria', 'BY', 'State'], ['Berlin', 'BE', 'State'],
    ['Brandenburg', 'BB', 'State'], ['Bremen', 'HB', 'State'], ['Hamburg', 'HH', 'State'],
    ['Hesse', 'HE', 'State'], ['Lower Saxony', 'NI', 'State'],
    ['Mecklenburg-Vorpommern', 'MV', 'State'], ['North Rhine-Westphalia', 'NW', 'State'],
    ['Rhineland-Palatinate', 'RP', 'State'], ['Saarland', 'SL', 'State'],
    ['Saxony', 'SN', 'State'], ['Saxony-Anhalt', 'ST', 'State'],
    ['Schleswig-Holstein', 'SH', 'State'], ['Thuringia', 'TH', 'State']
  ],
  ZA: [
    ['Eastern Cape', 'EC', 'Province'], ['Free State', 'FS', 'Province'],
    ['Gauteng', 'GP', 'Province'], ['KwaZulu-Natal', 'KZN', 'Province'],
    ['Limpopo', 'LP', 'Province'], ['Mpumalanga', 'MP', 'Province'],
    ['North West', 'NW', 'Province'], ['Northern Cape', 'NC', 'Province'],
    ['Western Cape', 'WC', 'Province']
  ],
  NZ: [
    ['Auckland', 'AUK', 'Region'], ['Canterbury', 'CAN', 'Region'],
    ['Wellington', 'WGN', 'Region'], ['Waikato', 'WKO', 'Region'],
    ['Otago', 'OTA', 'Region'], ['Bay of Plenty', 'BOP', 'Region']
  ]
};

/* "ISO2:STATE_CODE" -> [city names] */
export const CITIES = {
  'IN:AP': ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Kurnool', 'Rajahmundry', 'Tirupati', 'Kakinada'],
  'IN:AR': ['Itanagar', 'Naharlagun', 'Pasighat', 'Tawang'],
  'IN:AS': ['Guwahati', 'Silchar', 'Dibrugarh', 'Jorhat', 'Nagaon', 'Tinsukia'],
  'IN:BR': ['Patna', 'Gaya', 'Bhagalpur', 'Muzaffarpur', 'Darbhanga', 'Purnia'],
  'IN:CG': ['Raipur', 'Bhilai', 'Bilaspur', 'Korba', 'Durg', 'Rajnandgaon'],
  'IN:GA': ['Panaji', 'Margao', 'Vasco da Gama', 'Mapusa', 'Ponda'],
  'IN:GJ': ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 'Jamnagar', 'Gandhinagar', 'Junagadh'],
  'IN:HR': ['Gurugram', 'Faridabad', 'Panipat', 'Ambala', 'Karnal', 'Hisar', 'Rohtak', 'Sonipat'],
  'IN:HP': ['Shimla', 'Dharamshala', 'Solan', 'Mandi', 'Kullu', 'Manali'],
  'IN:JH': ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro', 'Hazaribagh', 'Deoghar'],
  'IN:KA': ['Bengaluru', 'Mysuru', 'Hubballi', 'Mangaluru', 'Belagavi', 'Davanagere', 'Ballari', 'Shivamogga', 'Tumakuru'],
  'IN:KL': ['Kochi', 'Thiruvananthapuram', 'Kozhikode', 'Thrissur', 'Kollam', 'Kannur', 'Alappuzha', 'Palakkad'],
  'IN:MP': ['Indore', 'Bhopal', 'Jabalpur', 'Gwalior', 'Ujjain', 'Sagar', 'Satna', 'Ratlam'],
  'IN:MH': ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Thane', 'Aurangabad', 'Solapur', 'Navi Mumbai', 'Kolhapur', 'Amravati'],
  'IN:MN': ['Imphal', 'Thoubal', 'Bishnupur', 'Churachandpur'],
  'IN:ML': ['Shillong', 'Tura', 'Jowai', 'Nongstoin'],
  'IN:MZ': ['Aizawl', 'Lunglei', 'Champhai', 'Serchhip'],
  'IN:NL': ['Kohima', 'Dimapur', 'Mokokchung', 'Tuensang'],
  'IN:OD': ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Berhampur', 'Sambalpur', 'Puri'],
  'IN:PB': ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda', 'Mohali', 'Pathankot'],
  'IN:RJ': ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Ajmer', 'Bikaner', 'Bhilwara', 'Alwar'],
  'IN:SK': ['Gangtok', 'Namchi', 'Gyalshing', 'Mangan'],
  'IN:TN': ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Erode', 'Vellore', 'Thoothukudi'],
  'IN:TG': ['Hyderabad', 'Warangal', 'Nizamabad', 'Karimnagar', 'Khammam', 'Ramagundam', 'Secunderabad', 'Mahbubnagar'],
  'IN:TR': ['Agartala', 'Udaipur', 'Dharmanagar', 'Kailashahar'],
  'IN:UP': ['Lucknow', 'Kanpur', 'Ghaziabad', 'Agra', 'Varanasi', 'Meerut', 'Prayagraj', 'Noida', 'Bareilly', 'Aligarh', 'Moradabad', 'Gorakhpur'],
  'IN:UK': ['Dehradun', 'Haridwar', 'Roorkee', 'Haldwani', 'Rudrapur', 'Nainital', 'Rishikesh'],
  'IN:WB': ['Kolkata', 'Howrah', 'Durgapur', 'Asansol', 'Siliguri', 'Bardhaman', 'Malda', 'Kharagpur'],
  'IN:AN': ['Port Blair', 'Diglipur', 'Mayabunder'],
  'IN:CH': ['Chandigarh'],
  'IN:DH': ['Daman', 'Diu', 'Silvassa'],
  'IN:DL': ['New Delhi', 'Delhi', 'Dwarka', 'Rohini', 'Saket', 'Karol Bagh', 'Pitampura'],
  'IN:JK': ['Srinagar', 'Jammu', 'Anantnag', 'Baramulla', 'Udhampur', 'Katra'],
  'IN:LA': ['Leh', 'Kargil'],
  'IN:LD': ['Kavaratti', 'Agatti', 'Minicoy'],
  'IN:PY': ['Puducherry', 'Karaikal', 'Yanam', 'Mahe'],

  'US:CA': ['Los Angeles', 'San Francisco', 'San Diego', 'San Jose', 'Sacramento', 'Fresno', 'Oakland'],
  'US:NY': ['New York City', 'Buffalo', 'Rochester', 'Albany', 'Syracuse'],
  'US:TX': ['Houston', 'Dallas', 'Austin', 'San Antonio', 'Fort Worth', 'El Paso'],
  'US:FL': ['Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Fort Lauderdale'],
  'US:IL': ['Chicago', 'Aurora', 'Naperville', 'Springfield'],
  'US:WA': ['Seattle', 'Spokane', 'Tacoma', 'Bellevue'],
  'US:MA': ['Boston', 'Worcester', 'Springfield', 'Cambridge'],
  'US:GA': ['Atlanta', 'Augusta', 'Savannah', 'Columbus'],
  'US:AZ': ['Phoenix', 'Tucson', 'Mesa', 'Scottsdale'],
  'US:NV': ['Las Vegas', 'Reno', 'Henderson'],
  'US:CO': ['Denver', 'Colorado Springs', 'Aurora', 'Boulder'],
  'US:NJ': ['Newark', 'Jersey City', 'Paterson', 'Trenton'],
  'US:PA': ['Philadelphia', 'Pittsburgh', 'Allentown'],
  'US:OH': ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo'],
  'US:MI': ['Detroit', 'Grand Rapids', 'Ann Arbor'],
  'US:NC': ['Charlotte', 'Raleigh', 'Greensboro', 'Durham'],
  'US:DC': ['Washington'],

  'AE:DU': ['Dubai', 'Deira', 'Jumeirah', 'Bur Dubai'],
  'AE:AZ': ['Abu Dhabi', 'Al Ain', 'Madinat Zayed'],
  'AE:SH': ['Sharjah', 'Khor Fakkan', 'Kalba'],
  'AE:AJ': ['Ajman'], 'AE:UQ': ['Umm Al Quwain'],
  'AE:RK': ['Ras Al Khaimah'], 'AE:FU': ['Fujairah'],

  'GB:ENG': ['London', 'Manchester', 'Birmingham', 'Leeds', 'Liverpool', 'Bristol', 'Newcastle', 'Sheffield'],
  'GB:SCT': ['Edinburgh', 'Glasgow', 'Aberdeen', 'Dundee'],
  'GB:WLS': ['Cardiff', 'Swansea', 'Newport'],
  'GB:NIR': ['Belfast', 'Londonderry'],

  'CA:ON': ['Toronto', 'Ottawa', 'Mississauga', 'Hamilton', 'London'],
  'CA:BC': ['Vancouver', 'Victoria', 'Surrey', 'Burnaby'],
  'CA:QC': ['Montreal', 'Quebec City', 'Laval', 'Gatineau'],
  'CA:AB': ['Calgary', 'Edmonton', 'Red Deer'],

  'AU:NSW': ['Sydney', 'Newcastle', 'Wollongong'],
  'AU:VIC': ['Melbourne', 'Geelong', 'Ballarat'],
  'AU:QLD': ['Brisbane', 'Gold Coast', 'Cairns', 'Townsville'],
  'AU:WA': ['Perth', 'Fremantle', 'Bunbury'],
  'AU:SA': ['Adelaide'], 'AU:TAS': ['Hobart', 'Launceston'],
  'AU:ACT': ['Canberra'], 'AU:NT': ['Darwin', 'Alice Springs'],

  'SG:SG': ['Singapore'],
  'HK:HK': ['Hong Kong', 'Kowloon', 'Tsuen Wan'],

  'MY:KUL': ['Kuala Lumpur'], 'MY:SGR': ['Shah Alam', 'Petaling Jaya', 'Subang Jaya', 'Klang'],
  'MY:PNG': ['George Town', 'Butterworth'], 'MY:JHR': ['Johor Bahru', 'Batu Pahat'],
  'MY:SBH': ['Kota Kinabalu', 'Sandakan'], 'MY:SWK': ['Kuching', 'Miri'],

  'DE:BE': ['Berlin'], 'DE:BY': ['Munich', 'Nuremberg', 'Augsburg'],
  'DE:HH': ['Hamburg'], 'DE:NW': ['Cologne', 'Düsseldorf', 'Dortmund', 'Essen'],
  'DE:HE': ['Frankfurt', 'Wiesbaden', 'Kassel'], 'DE:BW': ['Stuttgart', 'Karlsruhe', 'Mannheim'],

  'ZA:GP': ['Johannesburg', 'Pretoria', 'Soweto'],
  'ZA:WC': ['Cape Town', 'Stellenbosch'], 'ZA:KZN': ['Durban', 'Pietermaritzburg'],

  'NZ:AUK': ['Auckland'], 'NZ:WGN': ['Wellington'], 'NZ:CAN': ['Christchurch'],
  'NZ:WKO': ['Hamilton'], 'NZ:OTA': ['Dunedin', 'Queenstown'], 'NZ:BOP': ['Tauranga', 'Rotorua']
};

/*
 * Countries with no state list above still get one row, so the cascade never
 * dead-ends. A signup in Kenya picks "Kenya → Kenya → Nairobi" rather than
 * finding an empty dropdown and no way forward.
 *
 * Marked with type 'Country' so a later real import can recognise and replace
 * these placeholders rather than leaving them alongside genuine divisions.
 */
export const CAPITALS = {
  ID: 'Jakarta', PH: 'Manila', TH: 'Bangkok', VN: 'Hanoi', BD: 'Dhaka',
  LK: 'Colombo', NP: 'Kathmandu', PK: 'Karachi', SA: 'Riyadh', QA: 'Doha',
  KW: 'Kuwait City', OM: 'Muscat', BH: 'Manama', NG: 'Lagos', KE: 'Nairobi',
  EG: 'Cairo', FR: 'Paris', ES: 'Madrid', IT: 'Rome', NL: 'Amsterdam',
  IE: 'Dublin', PT: 'Lisbon', PL: 'Warsaw', TR: 'Istanbul', BR: 'São Paulo',
  MX: 'Mexico City', AR: 'Buenos Aires', CL: 'Santiago', JP: 'Tokyo',
  KR: 'Seoul', CN: 'Shanghai', CH: 'Zurich', SE: 'Stockholm', NO: 'Oslo',
  DK: 'Copenhagen'
};
