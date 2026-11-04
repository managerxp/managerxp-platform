import { Gamepad2, Flag, Sparkles } from 'lucide-react';

/*
 * The three ManagerXP products, in one place. The nav dropdown, the homepage
 * product cards, the /products hub and the footer all read this, so a product
 * is described (and FlowXP is treated as external, new tab) the same way
 * everywhere. `stations` are the product's real modules.
 */
export const PRODUCTS = [
  {
    id: 'cafexp',
    Icon: Gamepad2,
    name: 'CafeXP',
    category: 'Gaming Café Management',
    description:
      'An intelligent management platform designed to simplify gaming café operations, session management, billing, customer management, and business analytics.',
    stations: ['Sessions', 'Billing', 'Stations', 'F&B stock', 'Staff', 'Analytics', 'AI'],
    status: 'available',
    statusLabel: 'Available',
    to: '/products/cafexp',
    cta: 'Explore CafeXP',
  },
  {
    id: 'racexp',
    Icon: Flag,
    name: 'RaceXP',
    category: 'Sim Racing Technology',
    description:
      'A technology platform for sim racing environments, combining telemetry insights, racing operations, and intelligent management capabilities.',
    stations: ['Telemetry', 'Race sessions', 'Lap timing', 'Venue ops'],
    status: 'development',
    statusLabel: 'In development',
    to: '/products/racexp',
    cta: 'Explore RaceXP',
  },
  {
    id: 'flowxp',
    Icon: Sparkles,
    name: 'FlowXP',
    category: 'AI-Powered Business Management',
    description:
      'An intelligent business management and billing platform designed to simplify workflows, streamline operations, and support growing businesses.',
    stations: ['Billing', 'Stock', 'GST', 'Payments', 'AI insights'],
    status: 'available',
    statusLabel: 'Available',
    href: 'https://flowxp.in',
    external: true,
    cta: 'Explore FlowXP',
  },
];
