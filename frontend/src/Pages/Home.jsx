import React from 'react'
import HeroSection from '../components/Hero'
import ProblemSolution from '../components/ProblemSolution'
import CafeFloor from '../components/CafeFloor'
import WhyUsPage from '../components/WhyUs'
import MissionVisionPage from '../components/MissionVisionPage'
import FAQ from '../components/FAQ'
import DemoRibbon from '../components/Ribon'

// Narrative order: what it is -> the problem -> the product in action ->
// why us -> who we are -> questions -> trial CTA.
const Home = () => {
  return (
    <div>
      <HeroSection />
      <ProblemSolution />
      <CafeFloor />
      <WhyUsPage />
      <MissionVisionPage />
      <FAQ />
      <DemoRibbon />
    </div>
  )
}

export default Home
