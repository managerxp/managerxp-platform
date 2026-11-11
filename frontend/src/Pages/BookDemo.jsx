import React, { useRef, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { sendDemoRequest } from '../lib/contactEmail';
import { fieldClass as fieldClasses, labelClass as labelClasses } from '../lib/formStyles';
import Seo from '../components/site/Seo';
import SectionHeading from '../components/SectionHeading';
import FormStatus from '../components/site/FormStatus';

const softwareOptions = [
  { value: 'CafeXP (gaming café)', label: 'Gaming café', description: 'CafeXP for gaming lounges and esports floors' },
  { value: 'CafeXP (internet café)', label: 'Internet café', description: 'CafeXP for internet and browsing centres' }
];

const BookDemoPage = () => {
  const formRef = useRef(null);

  // State for form submission
  const [status, setStatus] = useState({ type: '', message: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedSoftware, setSelectedSoftware] = useState('');

  const sendEmail = (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setStatus({ type: '', message: '' });

    sendDemoRequest(formRef.current)
      .then(() => {
          setStatus({ type: 'success', message: 'Request received. We will email you to schedule a time.' });
          formRef.current.reset();
          setSelectedSoftware('');
      }, (error) => {
          setStatus({
            type: error.status === 503 ? 'warn' : 'error',
            message: error.message || 'Your request could not be sent. Please try again, or email managerxp2026@gmail.com.'
          });
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  return (
    <div className="bg-sheet font-display text-carbon antialiased">
      <Seo
        title="Book a CafeXP Demo | ManagerXP"
        description="Schedule a live CafeXP walkthrough against your own café floor plan: sessions, billing, stock, staff and analytics."
        path="/demo"
      />

      <div className="wrap max-w-4xl pb-20 pt-12 sm:pb-20 sm:pt-16">
        <SectionHeading
          as="h1"
          title="Book a CafeXP demo"
          description="A live walkthrough with the team, run against your own floor plan. Tell us a little about your café and we will schedule a time."
          className="mb-12"
        />

        <div className="border-t border-carbon pt-10">
              <form ref={formRef} onSubmit={sendEmail} className="space-y-6">

                <FormStatus status={status} />

                {/* Row 1: Name & Organization */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
                  <div>
                    <label htmlFor="user_name" className={labelClasses}> Your Name
                    </label>
                    <input
                      id="user_name"
                      type="text"
                      name="user_name"
                      required
                      autoComplete="name"
                      className={fieldClasses}
                     
                    />
                  </div>
                  <div>
                    <label htmlFor="organization_name" className={labelClasses}> Organization
                    </label>
                    <input
                      id="organization_name"
                      type="text"
                      name="organization_name"
                      required
                      autoComplete="organization"
                      className={fieldClasses}
                      placeholder="Café or company name"
                    />
                  </div>
                </div>

                {/* Row 2: Email & Phone */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
                  <div>
                    <label htmlFor="user_email" className={labelClasses}> Email Address
                    </label>
                    <input
                      id="user_email"
                      type="email"
                      name="user_email"
                      required
                      autoComplete="email"
                      className={fieldClasses}
                      placeholder="you@company.com"
                    />
                  </div>
                  <div>
                    <label htmlFor="phone_number" className={labelClasses}> Phone Number
                    </label>
                    <input
                      id="phone_number"
                      type="tel"
                      name="phone_number"
                      required
                      autoComplete="tel"
                      className={fieldClasses}
                      placeholder="+91"
                    />
                  </div>
                </div>

                {/* Row 3: Software Selection */}
                <fieldset>
                  <legend className={labelClasses}>Your café</legend>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {softwareOptions.map((option) => {
                      const isSelected = selectedSoftware === option.value;
                      return (
                        <label
                          key={option.value}
                          className={`relative flex items-center gap-4 border p-4 focus-within:outline focus-within:outline-2 focus-within:outline-signal
                                      ${isSelected ? 'border-carbon bg-white' : 'border-carbon/30 hover:border-carbon'}`}
                        >
                          <input
                            type="radio"
                            name="software_type"
                            value={option.value}
                            className="sr-only"
                            checked={isSelected}
                            onChange={(e) => setSelectedSoftware(e.target.value)}
                            required
                          />
                          <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[3px] ${isSelected ? 'border-signal' : 'border-carbon/40'}`} />
                          <div className="min-w-0">
                            <span className="block text-[15px] font-medium text-carbon">{option.label}</span>
                            <span className="text-[13px] text-graphite">{option.description}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                {/* Row 4: Subject */}
                <div>
                  <label htmlFor="subject" className={labelClasses}>Subject</label>
                  <input
                    id="subject"
                    type="text"
                    name="subject"
                    required
                    className={fieldClasses}
                    placeholder="How can we help you?"
                  />
                </div>

                {/* Row 5: Message */}
                <div>
                  <label htmlFor="message" className={labelClasses}>Message</label>
                  <textarea
                    id="message"
                    name="message"
                    rows="4"
                    required
                    className={`${fieldClasses} resize-y min-h-28`}
                    placeholder="Tell us about your project or requirements..."
                  />
                </div>

                {/* Submit Button */}
                <div className="pt-2 sm:pt-4">
                  <button type="submit" disabled={isSubmitting} className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:min-w-[14rem]">
                    {isSubmitting ? (
                      <>
                        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      <>
                        Request a demo
                        <ArrowRight aria-hidden="true" className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </div>
              </form>
        </div>
      </div>
    </div>
  );
};

export default BookDemoPage;
