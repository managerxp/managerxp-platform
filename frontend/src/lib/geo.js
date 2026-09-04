/*
 * Countries, dialling codes and states.
 *
 * A local table rather than a package or an API call. Signup is the one form
 * that must work on a bad connection in a café at 11pm, and a country list
 * that arrives late — or not at all — turns a required field into a dead end.
 * The whole thing is a few kilobytes.
 *
 * States are listed only for the countries where the divisions are stable,
 * well known and genuinely used in an address. Everywhere else the form falls
 * back to a text field, which is the honest answer: a dropdown with the wrong
 * regions in it is worse than a box, because it forces a wrong choice.
 */

/* [name, ISO2, dial code, default currency] */
const RAW = [
  ['India', 'IN', '91', 'INR'],
  ['United States', 'US', '1', 'USD'],
  ['United Kingdom', 'GB', '44', 'GBP'],
  ['United Arab Emirates', 'AE', '971', 'AED'],
  ['Canada', 'CA', '1', 'CAD'],
  ['Australia', 'AU', '61', 'AUD'],
  ['Singapore', 'SG', '65', 'SGD'],
  ['Malaysia', 'MY', '60', 'MYR'],
  ['Indonesia', 'ID', '62', 'IDR'],
  ['Philippines', 'PH', '63', 'PHP'],
  ['Thailand', 'TH', '66', 'THB'],
  ['Vietnam', 'VN', '84', 'VND'],
  ['Bangladesh', 'BD', '880', 'BDT'],
  ['Sri Lanka', 'LK', '94', 'LKR'],
  ['Nepal', 'NP', '977', 'NPR'],
  ['Pakistan', 'PK', '92', 'PKR'],
  ['Saudi Arabia', 'SA', '966', 'SAR'],
  ['Qatar', 'QA', '974', 'QAR'],
  ['Kuwait', 'KW', '965', 'KWD'],
  ['Oman', 'OM', '968', 'OMR'],
  ['Bahrain', 'BH', '973', 'BHD'],
  ['South Africa', 'ZA', '27', 'ZAR'],
  ['Nigeria', 'NG', '234', 'NGN'],
  ['Kenya', 'KE', '254', 'KES'],
  ['Egypt', 'EG', '20', 'EGP'],
  ['Germany', 'DE', '49', 'EUR'],
  ['France', 'FR', '33', 'EUR'],
  ['Spain', 'ES', '34', 'EUR'],
  ['Italy', 'IT', '39', 'EUR'],
  ['Netherlands', 'NL', '31', 'EUR'],
  ['Ireland', 'IE', '353', 'EUR'],
  ['Portugal', 'PT', '351', 'EUR'],
  ['Poland', 'PL', '48', 'PLN'],
  ['Turkey', 'TR', '90', 'TRY'],
  ['Brazil', 'BR', '55', 'BRL'],
  ['Mexico', 'MX', '52', 'MXN'],
  ['Argentina', 'AR', '54', 'ARS'],
  ['Chile', 'CL', '56', 'CLP'],
  ['Japan', 'JP', '81', 'JPY'],
  ['South Korea', 'KR', '82', 'KRW'],
  ['China', 'CN', '86', 'CNY'],
  ['Hong Kong', 'HK', '852', 'HKD'],
  ['New Zealand', 'NZ', '64', 'NZD'],
  ['Switzerland', 'CH', '41', 'CHF'],
  ['Sweden', 'SE', '46', 'SEK'],
  ['Norway', 'NO', '47', 'NOK'],
  ['Denmark', 'DK', '45', 'DKK']
];

export const COUNTRIES = RAW.map(([name, code, dial, currency]) => ({ name, code, dial, currency }));

export const countryByCode = (code) => COUNTRIES.find((c) => c.code === code) || null;

/* Flag from the ISO code, so no image assets and no list of emoji to keep in
   step with the country table. Falls back to nothing if the code is odd. */
export const flagOf = (code) => {
  if (!/^[A-Za-z]{2}$/.test(code || '')) return '';
  return String.fromCodePoint(
    ...code.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
};

const IN = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
];

const US = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
  'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois',
  'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts',
  'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota',
  'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
  'West Virginia', 'Wisconsin', 'Wyoming'
];

const CA = ['Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador',
  'Northwest Territories', 'Nova Scotia', 'Nunavut', 'Ontario', 'Prince Edward Island',
  'Quebec', 'Saskatchewan', 'Yukon'];

const AU = ['Australian Capital Territory', 'New South Wales', 'Northern Territory',
  'Queensland', 'South Australia', 'Tasmania', 'Victoria', 'Western Australia'];

const AE = ['Abu Dhabi', 'Ajman', 'Dubai', 'Fujairah', 'Ras Al Khaimah', 'Sharjah', 'Umm Al Quwain'];

const GB = ['England', 'Scotland', 'Wales', 'Northern Ireland'];

const MY = ['Johor', 'Kedah', 'Kelantan', 'Kuala Lumpur', 'Labuan', 'Melaka', 'Negeri Sembilan',
  'Pahang', 'Penang', 'Perak', 'Perlis', 'Putrajaya', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu'];

const STATES = { IN, US, CA, AU, AE, GB, MY };

/** States for a country, or null when the form should use a text field. */
export const statesOf = (code) => STATES[code] || null;

/**
 * Split a stored phone number back into a dial code and the rest.
 *
 * Longest dial code first, or '+1' would claim every '+1...' number before
 * a three-digit code like '+91' ever got a chance — and India would end up
 * filed under the United States.
 */
export const splitPhone = (value, fallbackCode = 'IN') => {
  const raw = String(value || '').trim();
  if (raw.startsWith('+')) {
    const dials = [...new Set(COUNTRIES.map((c) => c.dial))].sort((a, b) => b.length - a.length);
    for (const dial of dials) {
      if (raw.slice(1).startsWith(dial)) {
        const country = COUNTRIES.find((c) => c.dial === dial);
        return { dial, number: raw.slice(1 + dial.length).trim(), code: country?.code || fallbackCode };
      }
    }
  }
  const fb = countryByCode(fallbackCode);
  return { dial: fb?.dial || '91', number: raw.replace(/^\+/, ''), code: fallbackCode };
};

/** Store one string, so nothing downstream has to reassemble it. */
export const joinPhone = (dial, number) => {
  const digits = String(number || '').replace(/[^\d]/g, '');
  return digits ? `+${dial} ${digits}` : '';
};
