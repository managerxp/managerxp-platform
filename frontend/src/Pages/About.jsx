import React from 'react';
import { Gamepad2, Monitor, Brain, Target, Eye, Users, CheckCircle } from 'lucide-react';
import PageBackground from '../components/PageBackground';
import SectionHeading from '../components/SectionHeading';
import Reveal from '../components/Reveal';

const whyUsPoints = [
  "Built specifically for gaming & internet cafes",
  "Real-time monitoring & reporting",
  "Advanced telemetry data tracking",
  "Custom CRM integration",
  "AI-ready infrastructure",
  "Scalable architecture",
  "Security-first approach"
];

const whatWeDo = [
  {
    icon: <Gamepad2 className="w-6 h-6 text-red-500" />,
    title: "Gaming Cafe Software",
    desc: "High-performance systems with telemetry data, session control, tournament handling, and smart billing."
  },
  {
    icon: <Monitor className="w-6 h-6 text-red-400" />,
    title: "Internet Cafe Software",
    desc: "Secure user access management, automated billing, centralized control, and real-time reporting."
  },
  {
    icon: <Brain className="w-6 h-6 text-red-500" />,
    title: "AI Solutions",
    desc: "Predict peak hours, analyze behavior, forecast revenue, detect anomalies, and optimize operations."
  }
];

const founders = [
  {
    name: "Abdul Hayyu",
    role: "Founder",
    initials: "AH",
    origin: "Hyderabad",
    bio: [
      "I’m a Computer Science Engineer and developer driven by a passion for building technology that solves real-world problems. I founded ManagerXP with the vision of creating practical, scalable, and industry-focused software that makes business operations simpler and more efficient.",
      "I’m deeply involved in the product, technology, and overall direction of ManagerXP. From understanding customer challenges to designing solutions, developing products, and continuously improving them, I remain closely connected to every stage of the journey. I believe in building with consistency, learning continuously, and staying committed until an idea becomes a reliable product that people can genuinely depend on.",
      "My focus is not just on building software, but on creating technology that delivers real value, improves everyday operations, and can grow alongside the businesses that use it."
    ]
  },
  {
    name: "Mubashir Lone",
    role: "Co-Founder",
    initials: "ML",
    origin: "Hyderabad",
    bio: [
      "I’m a Computer Science Engineer and co-founder of ManagerXP, passionate about technology, product development, and solving complex problems through software. I work closely with the team to turn ideas and business requirements into reliable, scalable, and practical technology solutions.",
      "I’m committed to the continuous development of ManagerXP and contribute across product development, technology, and execution. I believe great products are built through attention to detail, continuous improvement, and a strong understanding of the people and businesses they are designed for.",
      "As a co-founder, my focus is on supporting the company’s vision, strengthening its technology foundation, and helping transform ideas into products that businesses can use and rely on every day."
    ]
  }
];

const pillars = [
  {
    icon: <Eye className="w-6 h-6 text-red-500" />,
    title: "Our Vision",
    body: "To become a global leader in cafe management and AI-driven business ecosystems by delivering scalable, secure, and performance-oriented software solutions.",
    note: "// Redefining how digital spaces operate."
  },
  {
    icon: <Target className="w-6 h-6 text-red-500" />,
    title: "Our Mission",
    body: "To empower cafe owners with smart technology that reduces complexity, increases operational control, and drives sustainable growth through innovation.",
    note: "// Driving sustainable growth via AI."
  }
];

const AboutPage = () => {
  return (
    <div className="relative min-h-screen bg-black overflow-hidden antialiased font-sans text-white">

      <PageBackground streakTop="top-1/4" streakBottom="bottom-1/3" />

      {/* --- Main Content --- */}
      <div className="relative z-10 max-w-6xl mx-auto px-5 sm:px-6 section-y">

        <SectionHeading
          as="h1"
          eyebrow="System Identity"
          title="ABOUT"
          highlight="MANAGERXP"
          description="A next-generation cafe software and AI solutions provider dedicated to transforming how digital spaces operate."
          className="mb-12 sm:mb-14"
        />

        {/* Section 1: Who We Are & Our Story */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 mb-14 sm:mb-16">

          {/* Who We Are */}
          <Reveal className="h-full">
            <div className="bg-white/[0.02] border border-white/10 rounded-xl p-6 sm:p-8 backdrop-blur-sm relative overflow-hidden group hover:border-red-500/30 transition-all duration-500 h-full">
              <div aria-hidden="true" className="absolute top-0 right-0 w-32 h-32 border-t border-r border-white/5 rounded-tr-3xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <h2 className="text-lg sm:text-xl font-semibold text-white mb-4 flex items-center gap-3">
                <Users className="w-5 h-5 text-red-500 shrink-0" />
                Who We Are
              </h2>
              <p className="text-neutral-300 text-sm leading-relaxed mb-4 text-pretty">
                Founded in <span className="text-white">2026</span>, MANAGERXP PRIVATE LIMITED is a next-generation cafe software and AI solutions provider. We specialize in building intelligent management platforms that combine automation, real-time monitoring, billing systems, and AI-driven analytics.
              </p>
              <p className="text-neutral-500 text-sm leading-relaxed text-pretty">
                From high-performance gaming arenas to traditional cyber cafes, our solutions are designed to simplify operations, improve efficiency, and maximize profitability.
              </p>
            </div>
          </Reveal>

          {/* Our Story - Terminal Style */}
          <Reveal delay={120} direction="right" className="h-full">
            <div className="bg-neutral-900 border border-white/10 rounded-xl p-1 font-mono text-xs shadow-xl relative overflow-hidden h-full flex flex-col">
              <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                <span className="text-neutral-600 ml-2 text-[10px]">origin_story.log</span>
              </div>
              <div className="p-5 flex-1 overflow-x-auto">
                <pre className="text-neutral-400 leading-relaxed whitespace-pre-wrap">
                  <code>
<span className="text-red-500">const</span> vision = <span className="text-yellow-400">"Change outdated systems"</span>;{'\n'}
{'\n'}
<span className="text-neutral-600">/* Traditional systems were fragmented. */</span>{'\n'}
<span className="text-red-400">managerXP</span>.init({'{'}
  integration: [<span className="text-green-400">'Gaming Session Control'</span>],{'\n'}
  monitoring: [<span className="text-green-400">'Real-time System Data'</span>],{'\n'}
  intelligence: [<span className="text-green-400">'AI Business Logic'</span>],{'\n'}
  billing: <span className="text-red-400">Automated</span>{'\n'}
{'}'});{'\n'}
{'\n'}
<span className="text-neutral-600">// Goal: Smart, scalable, future-ready.</span>
                  </code>
                </pre>
              </div>
            </div>
          </Reveal>
        </div>

        {/* Section 1.5: Founders */}
        <div className="mb-14 sm:mb-16">
          <SectionHeading
            title="Founders"
            description="The people behind ManagerXP."
            className="mb-10"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
            {founders.map((person, index) => (
              <Reveal key={person.name} delay={index * 120} className="h-full">
                <div className="bg-white/[0.02] border border-white/10 rounded-xl p-6 sm:p-8 backdrop-blur-sm hover:border-red-500/30 transition-all duration-500 h-full">
                  <div className="flex items-start gap-4 mb-4">
                    <div
                      aria-hidden="true"
                      className="shrink-0 w-14 h-14 rounded-full bg-gradient-to-br from-red-700 to-red-900 border border-white/10 flex items-center justify-center text-white font-semibold text-lg shadow-[0_0_20px_-5px_rgba(220,38,38,0.4)]"
                    >
                      {person.initials}
                    </div>
                    <div>
                      <h3 className="text-base sm:text-lg font-semibold text-white">{person.name}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400">
                          {person.role}
                        </span>
                        <span className="text-xs text-neutral-500">{person.origin}</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {person.bio.map((paragraph, i) => (
                      <p key={i} className="text-neutral-400 text-sm leading-relaxed text-pretty">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        {/* Section 2: What We Do */}
        <div className="mb-14 sm:mb-16">
          <SectionHeading
            title="What We Do"
            description="We don't just manage cafes — we build intelligent digital ecosystems."
            className="mb-10"
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {whatWeDo.map((item, index) => (
              <Reveal key={item.title} delay={index * 90} className="h-full">
                <div className="bg-white/[0.02] border border-white/10 p-6 rounded-xl hover:border-red-500/30 hover:-translate-y-1 motion-reduce:hover:translate-y-0 transition-all duration-300 group h-full">
                  <div className="p-3 border border-white/10 bg-white/5 rounded-lg w-fit mb-4 group-hover:border-red-500/30 group-hover:bg-red-500/10 transition-all">
                    {item.icon}
                  </div>
                  <h3 className="text-base sm:text-lg font-semibold text-white mb-2">{item.title}</h3>
                  <p className="text-xs text-neutral-500 leading-relaxed text-pretty">
                    {item.desc}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        {/* Section 3: Vision & Mission */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 mb-14 sm:mb-16">
          {pillars.map((pillar, index) => (
            <Reveal key={pillar.title} delay={index * 120} className="h-full">
              <div className="relative overflow-hidden group h-full">
                <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-red-900/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-xl" />
                <div className="relative border border-white/10 p-6 sm:p-8 rounded-xl bg-white/[0.02] backdrop-blur-sm h-full group-hover:border-red-500/30 transition-colors duration-300">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="shrink-0">{pillar.icon}</span>
                    <h3 className="text-lg sm:text-xl font-semibold text-white">{pillar.title}</h3>
                  </div>
                  <p className="text-neutral-300 text-sm leading-relaxed mb-4 text-pretty">
                    {pillar.body}
                  </p>
                  <p className="text-neutral-600 text-xs font-mono">
                    {pillar.note}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Section 4: Why ManagerXP */}
        <Reveal className="block">
          <div className="relative border border-white/10 rounded-xl p-6 sm:p-8 bg-white/[0.02] backdrop-blur-sm overflow-hidden">
            <div aria-hidden="true" className="absolute inset-0 opacity-[0.02] bg-[length:20px_20px] [background-image:linear-gradient(to_right,rgba(255,255,255,0.1)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.1)_1px,transparent_1px)]" />

            <div className="relative z-10">
              <h2 className="text-lg sm:text-xl font-semibold text-white mb-8 text-center">
                Why <span className="text-red-500">ManagerXP</span>?
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {whyUsPoints.map((point) => (
                  <div key={point} className="flex items-center gap-3 text-sm text-neutral-400 group hover:text-white transition-colors">
                    <CheckCircle className="w-4 h-4 text-red-500 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" />
                    <span>{point}</span>
                  </div>
                ))}
              </div>

              <div className="mt-8 pt-6 border-t border-white/5 text-center">
                <p className="text-neutral-500 text-sm font-mono text-pretty">
                  ManagerXP is not just a software provider.{' '}
                  <span className="block sm:inline">
                    We are a <span className="text-white">technology partner</span> committed to building the future of smart cafe ecosystems.
                  </span>
                </p>
              </div>
            </div>
          </div>
        </Reveal>

      </div>
    </div>
  );
};

export default AboutPage;
