import React from 'react';
import { Target, Eye, Globe, Cpu, Shield, Zap, Layers, Network } from 'lucide-react';
import PageBackground from './PageBackground';
import SectionHeading from './SectionHeading';
import Reveal from './Reveal';

const ecosystemItems = [
  { icon: <Cpu className="w-5 h-5" />, text: "Gaming Systems" },
  { icon: <Network className="w-5 h-5" />, text: "Cafe Operations" },
  { icon: <Zap className="w-5 h-5" />, text: "Billing & Monitoring" },
  { icon: <Layers className="w-5 h-5" />, text: "AI Analytics" },
  { icon: <Shield className="w-5 h-5" />, text: "Security & Automation" }
];

const visionPoints = [
  "Every gaming cafe runs on intelligent automation",
  "Every internet cafe operates with full transparency",
  "Businesses are powered by predictive AI insights",
  "All systems are connected inside one scalable ecosystem"
];

const MissionVisionPage = () => {
  return (
    <section className="section-seam relative bg-black overflow-hidden antialiased font-sans text-white">

      <PageBackground streakTop="top-1/3" streakBottom="bottom-1/4" />

      {/* --- Main Content --- */}
      <div className="relative z-10 max-w-6xl mx-auto px-5 sm:px-6 section-y">

        {/* Section 1: Our Mission */}
        <div className="mb-14 sm:mb-12 sm:mb-14">
          <SectionHeading
            eyebrow="Core Directive"
            icon={<Target className="w-3 h-3" />}
            title="OUR"
            highlight="MISSION"
            className="mb-12"
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-12 items-center">
            {/* Text Content */}
            <div>
              <Reveal>
                <p className="text-neutral-400 text-base sm:text-lg leading-relaxed mb-6 text-pretty">
                  To empower gaming cafes, internet cafes, and digital businesses with intelligent, secure, and high-performance software solutions — while building our own integrated technology ecosystem.
                </p>
                <div className="p-4 border-l-2 border-red-500 bg-white/[0.02] backdrop-blur-sm rounded-r-md">
                  <p className="text-neutral-300 font-mono text-sm italic">
                    "We are not just developing tools. We are building a complete ecosystem."
                  </p>
                </div>
              </Reveal>
            </div>

            {/* Ecosystem Visual Card */}
            <Reveal delay={120} direction="right">
              <div className="bg-neutral-900/50 border border-white/10 rounded-xl backdrop-blur-md font-mono text-xs relative overflow-hidden shadow-[0_0_50px_-20px_rgba(220,38,38,0.1)]">
                {/* Window Controls */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/[0.02]">
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                  </div>
                  <span className="text-neutral-600 text-xs">ecosystem.config</span>
                </div>

                <div className="p-5 space-y-3">
                  <p className="text-neutral-600 mb-2">// Unified Architecture Components:</p>
                  {ecosystemItems.map((item) => (
                    <div key={item.text} className="flex items-center gap-3 text-neutral-400 group hover:text-red-500 transition-colors cursor-default">
                      <span className="text-red-500/50 group-hover:text-red-500 transition-colors shrink-0">{item.icon}</span>
                      <span className="flex-1 border-b border-white/5 pb-1">{item.text}</span>
                      <span className="hidden sm:inline text-[10px] text-red-500 font-mono opacity-0 group-hover:opacity-100 transition-opacity">CONNECTED</span>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>

          {/* Bottom Text */}
          <Reveal className="mt-8 block">
            <div className="max-w-3xl mx-auto text-center">
              <p className="text-neutral-500 text-sm text-pretty">
                Our mission is to transform traditional cafe operations into <span className="text-white">smart</span>, <span className="text-white">scalable</span>, and <span className="text-white">data-driven</span> digital environments.
              </p>
            </div>
          </Reveal>
        </div>

        {/* Section Divider */}
        <div className="relative h-px bg-white/10 my-12 sm:my-14">
          <div className="absolute left-1/2 -translate-x-1/2 -top-3 bg-black px-4 text-neutral-600 text-[10px] sm:text-xs font-mono tracking-widest whitespace-nowrap">
            SYSTEM UPGRADE PATH
          </div>
        </div>

        {/* Section 2: Our Vision */}
        <div>
          <SectionHeading
            eyebrow="Future Protocol"
            icon={<Eye className="w-3 h-3" />}
            title="OUR"
            highlight="VISION"
            description="To build our own global ecosystem of AI-powered cafe and digital management solutions that redefine how modern digital spaces operate."
            className="mb-12"
          />

          {/* Vision Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">

            {/* Left: Future Vision Terminal */}
            <Reveal className="h-full">
              <div className="bg-white/[0.02] border border-white/10 rounded-xl p-6 sm:p-8 backdrop-blur-sm h-full relative overflow-hidden group transition-all duration-300 hover:border-red-500/30">
                {/* Background Glow */}
                <div className="absolute inset-0 bg-gradient-to-br from-red-900/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 rounded-lg border border-white/10 bg-white/5 group-hover:border-red-500/30 group-hover:bg-red-500/10 transition-all">
                      <Globe className="w-5 h-5 text-red-500" />
                    </div>
                    <h3 className="text-white font-semibold">Global Ecosystem</h3>
                  </div>

                  <ul className="space-y-5">
                    {visionPoints.map((point) => (
                      <li key={point} className="flex items-start gap-3 text-neutral-300 text-sm">
                        <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_10px_rgba(220,38,38,0.5)]" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Reveal>

            {/* Right: Evolution Card */}
            <Reveal delay={120} className="h-full">
              <div className="bg-white/[0.02] border border-white/10 rounded-xl p-6 sm:p-8 backdrop-blur-sm h-full flex flex-col justify-center relative overflow-hidden group transition-all duration-300 hover:border-red-500/30">
                {/* Decorative Lines */}
                <div className="absolute top-0 right-0 w-40 h-40 border-t border-r border-red-500/10 rounded-tr-3xl group-hover:border-red-500/20 transition-colors" />
                <div className="absolute bottom-0 left-0 w-40 h-40 border-b border-l border-red-500/10 rounded-bl-3xl group-hover:border-red-500/20 transition-colors" />

                <div className="text-center relative z-10">
                  <p className="text-neutral-600 font-mono text-xs mb-4 tracking-widest uppercase">The Evolution</p>
                  <h3 className="text-lg sm:text-xl font-semibold text-white mb-6 text-balance">
                    From Software to <span className="text-red-500">Intelligent Ecosystem</span>
                  </h3>
                  <div className="flex flex-wrap justify-center items-center gap-3 sm:gap-4 text-neutral-500 text-xs font-mono">
                    <span>Management</span>
                    <Zap className="w-3 h-3 text-red-500 animate-pulse shrink-0" />
                    <span>Automation</span>
                    <Zap className="w-3 h-3 text-red-500 animate-pulse shrink-0" />
                    <span>AI Core</span>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>

          {/* Closing Statement */}
          <Reveal className="flex justify-center px-2">
            <div className="flex items-center gap-3 px-5 sm:px-6 py-3 border border-white/10 rounded-full bg-white/[0.02] backdrop-blur-sm text-neutral-400 text-xs sm:text-sm font-mono text-center">
              <span className="shrink-0 w-2 h-2 rounded-full bg-red-500 shadow-[0_0_10px_rgba(220,38,38,0.5)] animate-pulse"></span>
              Aiming to lead the evolution of smart business ecosystems
            </div>
          </Reveal>
        </div>

      </div>
    </section>
  );
};

export default MissionVisionPage;
