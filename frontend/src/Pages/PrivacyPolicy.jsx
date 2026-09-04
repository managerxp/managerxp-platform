import React from 'react';
import { LegalPage, Section, BulletList } from '../components/legal/LegalPage';

const PrivacyPolicy = () => (
  <LegalPage
    title="Privacy Policy"
    hudLabel="privacy_policy"
    lastUpdated="19 August 2026"
    effectiveDate="19 August 2026"
  >
    <p>
      This Privacy Policy explains how ManagerXP collects, uses, stores, and protects information
      when you use the ManagerXP website, software, applications, and related services
      (collectively, the &quot;Service&quot;).
    </p>
    <p>By using ManagerXP, you acknowledge the practices described in this Privacy Policy.</p>

    <Section title="1. Information We Collect">
      <p>Depending on how you use ManagerXP, we may collect:</p>
      <BulletList
        items={[
          'Name and contact information',
          'Email address and phone number',
          'Business and account information',
          'Login and authentication information',
          'Customer and employee information entered by your business',
          'Products, menus, recipes, and inventory information',
          'Orders, sales, and transaction information',
          'Subscription and billing information',
          'Technical information such as IP address, browser, device, and operating system',
          'Usage, diagnostic, and error information',
        ]}
      />
      <p>We only collect information reasonably necessary to provide and operate our Service.</p>
    </Section>

    <Section title="2. Information You Provide">
      <p>You may provide information when you:</p>
      <BulletList
        items={[
          'Create an account',
          'Subscribe to ManagerXP',
          'Add employees or staff members',
          'Add customers',
          'Create menus or products',
          'Record orders or sales',
          'Manage inventory',
          'Contact customer support',
          'Communicate with us',
        ]}
      />
      <p>
        You are responsible for ensuring that information you provide to ManagerXP is accurate and
        that you have the necessary rights or permissions to provide personal information belonging
        to other individuals.
      </p>
    </Section>

    <Section title="3. How We Use Information">
      <p>We may use information to:</p>
      <BulletList
        items={[
          'Provide and operate ManagerXP',
          'Create and manage your account',
          'Process subscriptions and payments',
          'Provide customer support',
          'Manage authentication and security',
          'Process orders and business data',
          'Improve features and performance',
          'Detect fraud, abuse, and security threats',
          'Troubleshoot technical problems',
          'Send service-related notifications',
          'Send promotional communications where legally permitted',
          'Comply with applicable laws and regulations',
        ]}
      />
    </Section>

    <Section title="4. Business and Customer Data">
      <p>ManagerXP allows businesses to store information about their operations and customers.</p>
      <p>
        The business using ManagerXP is generally responsible for determining why customer or
        employee information is collected and how it is used. ManagerXP processes such information
        as necessary to provide the Service.
      </p>
      <p>
        Businesses using ManagerXP are responsible for providing appropriate notices and obtaining
        any required consent or authorization from their customers or employees.
      </p>
    </Section>

    <Section id="cookies" title="5. Cookies and Similar Technologies">
      <p>ManagerXP may use cookies and similar technologies to:</p>
      <BulletList
        items={[
          'Keep you signed in',
          'Remember preferences',
          'Maintain security',
          'Understand how the Service is used',
          'Improve website performance',
          'Analyse usage and traffic',
        ]}
      />
      <p>
        You can control or disable cookies through your browser settings, although some features may
        not function correctly as a result.
      </p>
    </Section>

    <Section title="6. Payment Information">
      <p>
        When you purchase a ManagerXP subscription, payments may be processed by third-party
        payment providers. We may receive information such as:
      </p>
      <BulletList
        items={['Transaction amount', 'Payment status', 'Transaction ID', 'Billing information', 'Subscription details']}
      />
      <p>
        Payment providers may process your payment information according to their own privacy
        policies and terms. ManagerXP generally does not store complete payment-card information.
      </p>
    </Section>

    <Section title="7. Analytics and Technical Information">
      <p>We may automatically collect technical and usage information, including:</p>
      <BulletList
        items={[
          'IP address',
          'Browser and device type',
          'Operating system',
          'Pages and features accessed',
          'Login and session information',
          'Error and diagnostic information',
          'Approximate location derived from technical information',
        ]}
      />
      <p>
        This information helps us maintain security, troubleshoot issues, understand usage, and
        improve ManagerXP.
      </p>
    </Section>

    <Section title="8. Marketing and Communications">
      <p>
        We may send you important communications relating to your account, subscription, security,
        and the Service. Where legally permitted, we may also send promotional communications about
        ManagerXP.
      </p>
      <p>
        You can unsubscribe from promotional communications at any time using the unsubscribe option
        provided in the communication. You may still receive essential service-related messages
        after unsubscribing from marketing communications.
      </p>
    </Section>

    <Section title="9. How We Share Information">
      <p>
        We may share information with trusted third-party service providers that help us operate
        ManagerXP, including providers for:
      </p>
      <BulletList
        items={[
          'Cloud hosting',
          'Database services',
          'Payment processing',
          'Email and SMS delivery',
          'Analytics',
          'Customer support',
          'Security and monitoring',
          'Backups and infrastructure',
        ]}
      />
      <p>
        We may also disclose information when required by law, to protect our rights and users,
        prevent fraud, or respond to lawful requests. We do not sell your personal information as a
        product.
      </p>
    </Section>

    <Section title="10. Data Security">
      <p>
        We use reasonable technical and organizational measures to protect information from
        unauthorized access, alteration, disclosure, loss, or destruction. Security measures may
        include access controls, authentication, encryption or secure transmission, monitoring,
        backups, and restricted employee access.
      </p>
      <p>
        However, no online service can guarantee absolute security. You are responsible for keeping
        your ManagerXP account credentials — including your password, which we cannot see or
        recover on your behalf — secure.
      </p>
    </Section>

    <Section title="11. Data Retention">
      <p>We retain information for as long as reasonably necessary to:</p>
      <BulletList
        items={[
          'Provide the Service',
          'Maintain your account',
          'Fulfil contractual obligations',
          'Comply with legal, tax, and accounting requirements',
          'Resolve disputes',
          'Prevent fraud and abuse',
          'Enforce our agreements',
        ]}
      />
      <p>
        When information is no longer required, we may delete, anonymize, or securely dispose of it,
        subject to applicable legal and operational requirements.
      </p>
    </Section>

    <Section title="12. Your Privacy Rights">
      <p>Depending on applicable law, you may have rights to:</p>
      <BulletList
        items={[
          'Request access to your personal information',
          'Request correction of inaccurate information',
          'Request deletion where legally applicable',
          'Withdraw consent where processing is based on consent',
          'Request information about how your personal information is processed',
          'Raise a privacy-related grievance',
          'Exercise other rights available under applicable law',
        ]}
      />
      <p>
        If your information is managed by a business using ManagerXP, you may need to contact that
        business directly regarding your personal information.
      </p>
    </Section>

    <Section title="13. Third-Party Services and Links">
      <p>
        ManagerXP may use or integrate with third-party services and may contain links to external
        websites. Third-party services may collect and process information according to their own
        privacy policies. ManagerXP is not responsible for the privacy practices or security of
        third-party websites or services.
      </p>
    </Section>

    <Section title="14. Children's Privacy">
      <p>
        ManagerXP is intended for businesses and is not designed for use by children. We do not
        knowingly collect personal information directly from children for independent use of the
        Service. If you believe that a child has provided personal information to us, please
        contact us so that we can investigate and take appropriate action.
      </p>
    </Section>

    <Section title="15. Changes and Contact Information">
      <p>
        We may update this Privacy Policy from time to time to reflect changes to our Service,
        business practices, technology, or applicable laws. When we make material changes, we may
        provide reasonable notice through the Service, website, or email.
      </p>
      <p>For questions, privacy requests, or complaints, contact:</p>
      <p className="text-neutral-400">
        ManagerXP Private Limited
        <br />
        Email: <a className="text-red-400 hover:text-red-300 underline" href="mailto:managerxp2026@gmail.com">managerxp2026@gmail.com</a>
        <br />
        Address: 8-2-644/1/205 F205, Hiline Complex, Road No.12, Banjara Hills, Hyderabad- 500034.
        <br />
        Website: managerxp.com
      </p>
      <p>
        This Privacy Policy is governed by the applicable laws of India, including applicable
        data-protection and information-technology laws and regulations. Where applicable,
        ManagerXP will comply with the requirements of the Digital Personal Data Protection Act,
        2023 and applicable rules made under it.
      </p>
    </Section>
  </LegalPage>
);

export default PrivacyPolicy;
