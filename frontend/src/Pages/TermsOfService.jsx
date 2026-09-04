import React from 'react';
import { LegalPage, Section, BulletList } from '../components/legal/LegalPage';

const TermsOfService = () => (
  <LegalPage
    title="Terms of Service"
    hudLabel="terms_of_service"
    lastUpdated="19 August 2026"
    effectiveDate="19 August 2026"
  >
    <p>
      These Terms of Service (&quot;Terms&quot;) govern your access to and use of ManagerXP,
      including its website, software, applications, and related services (collectively, the
      &quot;Service&quot;), provided by ManagerXP.
    </p>
    <p>
      By creating an account, subscribing to, or using ManagerXP, you agree to these Terms. If you
      do not agree, please do not use the Service.
    </p>

    <Section title="1. Eligibility and Account">
      <p>You must be legally capable of entering into a binding agreement to use ManagerXP.</p>
      <p>
        When creating an account, you agree to provide accurate and complete information and keep
        your account information up to date.
      </p>
      <p>
        You are responsible for maintaining the confidentiality of your login credentials and for
        all activity performed through your account. You must notify us promptly if you believe
        your account has been compromised.
      </p>
    </Section>

    <Section title="2. ManagerXP Services">
      <p>
        ManagerXP provides software designed to help cafés, restaurants, and similar businesses
        manage their operations. Depending on your subscription plan, features may include:
      </p>
      <BulletList
        items={[
          'Order and table management',
          'Digital/QR menus',
          'Inventory and recipe management',
          'Customer management',
          'Sales and business reports',
          'Purchasing and stock management',
          'Customer communication and marketing',
          'Order monitoring and analytics',
        ]}
      />
      <p>
        Features may vary depending on your subscription plan and may be changed or updated from
        time to time.
      </p>
    </Section>

    <Section title="3. Subscriptions and Payments">
      <p>Certain ManagerXP features require a paid subscription.</p>
      <p>
        Subscription prices, billing periods, features, and applicable taxes will be displayed
        before purchase. By subscribing, you authorize ManagerXP or its payment provider to charge
        the applicable fees.
      </p>
      <p>
        Unless otherwise stated, subscriptions automatically renew at the end of each billing
        period until cancelled.
      </p>
    </Section>

    <Section title="4. Cancellation and Refunds">
      <p>
        You may cancel your subscription at any time through the available account controls or by
        contacting us.
      </p>
      <p>
        Cancellation will generally take effect at the end of the current billing period, and you
        may continue using paid features until that time.
      </p>
      <p>
        Unless otherwise required by applicable law or specifically stated in your subscription
        terms, subscription payments are non-refundable.
      </p>
    </Section>

    <Section title="5. Free Trials and Promotions">
      <p>ManagerXP may offer free trials, discounts, or promotional plans.</p>
      <p>
        We may set eligibility requirements and limitations for these offers and may modify or
        discontinue them at any time.
      </p>
      <p>
        If a free trial converts into a paid subscription, you will be charged according to the
        terms presented when you started the trial.
      </p>
    </Section>

    <Section title="6. Your Business Data">
      <p>
        You retain ownership of the business information and content you upload or enter into
        ManagerXP, including products, menus, recipes, inventory, sales, customer information, and
        other business data.
      </p>
      <p>
        You grant ManagerXP permission to store and process this information as necessary to
        provide, maintain, secure, and improve the Service.
      </p>
      <p>
        You are responsible for ensuring that you have the necessary rights and permissions to
        provide such information to ManagerXP.
      </p>
    </Section>

    <Section title="7. Customer and Employee Information">
      <p>
        If you use ManagerXP to store information about customers, employees, or other individuals,
        you are responsible for complying with applicable privacy and data-protection laws.
      </p>
      <p>
        You must ensure that you have the appropriate permissions, notices, or legal basis required
        to collect and process such information.
      </p>
      <p>
        Our handling of personal information is described in the{' '}
        <a className="text-red-400 hover:text-red-300 underline" href="/privacy-policy">
          ManagerXP Privacy Policy
        </a>
        .
      </p>
    </Section>

    <Section title="8. Acceptable Use">
      <p>You agree not to:</p>
      <BulletList
        items={[
          "Use ManagerXP for unlawful or fraudulent activities.",
          "Attempt to access another user's account.",
          'Interfere with or disrupt the Service.',
          'Introduce viruses, malware, or harmful code.',
          'Reverse engineer or attempt to obtain the source code of the Service, except where permitted by law.',
          'Copy, resell, sublicense, or commercially exploit ManagerXP without our permission.',
          'Circumvent security measures, subscription restrictions, or usage limits.',
          "Use ManagerXP to violate another person's rights or privacy.",
        ]}
      />
      <p>We may suspend or terminate accounts that violate these requirements.</p>
    </Section>

    <Section title="9. Digital Menus and Business Content">
      <p>
        ManagerXP may allow you to create digital menus, QR menus, offers, and other
        customer-facing content.
      </p>
      <p>
        You are responsible for ensuring that your content, including prices, product descriptions,
        taxes, allergens, and promotional information, is accurate and complies with applicable
        laws.
      </p>
      <p>ManagerXP does not independently verify business content submitted by users.</p>
    </Section>

    <Section title="10. Third-Party Services">
      <p>
        ManagerXP may integrate with third-party services such as payment processors, messaging
        providers, analytics platforms, hosting providers, or other services.
      </p>
      <p>Your use of those services may be subject to their own terms and privacy policies.</p>
      <p>
        ManagerXP is not responsible for the availability, functionality, or policies of
        third-party services.
      </p>
    </Section>

    <Section title="11. Intellectual Property">
      <p>
        ManagerXP and its licensors own all rights to the ManagerXP software, website, design,
        branding, trademarks, documentation, and other proprietary materials.
      </p>
      <p>
        You receive a limited, non-exclusive, non-transferable right to use the Service during your
        active subscription.
      </p>
      <p>
        You may not copy, modify, distribute, sell, or create derivative works from ManagerXP
        without our written permission, except where permitted by law.
      </p>
    </Section>

    <Section title="12. Service Availability">
      <p>We will make reasonable efforts to keep ManagerXP available and operational.</p>
      <p>
        However, the Service may occasionally be unavailable due to maintenance, technical
        problems, security incidents, third-party failures, internet outages, or circumstances
        beyond our reasonable control.
      </p>
      <p>We do not guarantee that ManagerXP will always be uninterrupted or error-free.</p>
    </Section>

    <Section title="13. Suspension and Termination">
      <p>We may suspend or terminate your access to ManagerXP if:</p>
      <BulletList
        items={[
          'You materially violate these Terms.',
          'Your subscription payments remain unpaid.',
          'You use the Service unlawfully.',
          'Your activities create a security or legal risk.',
          'You attempt to compromise or misuse the Service.',
          'We are required to do so by law.',
        ]}
      />
      <p>Where reasonably possible, we will provide notice before termination.</p>
      <p>
        After termination, your right to use ManagerXP ends. Subject to applicable law and our
        retention policies, your data may subsequently be deleted or anonymized.
      </p>
    </Section>

    <Section title="14. Disclaimers and Limitation of Liability">
      <p>
        ManagerXP is provided on an &quot;as is&quot; and &quot;as available&quot; basis to the
        maximum extent permitted by law.
      </p>
      <p>
        We do not guarantee that the Service will meet every business requirement, operate without
        interruption, or be completely free from errors. ManagerXP is a software tool and does not
        provide accounting, tax, legal, financial, or other professional advice.
      </p>
      <p>
        To the maximum extent permitted by law, ManagerXP will not be liable for indirect,
        incidental, special, or consequential losses, including loss of profits, revenue, business
        opportunities, or data.
      </p>
      <p>
        Our total liability relating to the Service will not exceed the amount you paid to
        ManagerXP for the Service during the six months preceding the event giving rise to the
        claim.
      </p>
      <p>Nothing in these Terms limits liability that cannot legally be limited.</p>
    </Section>

    <Section title="15. Changes, Governing Law, and Contact">
      <p>
        We may update these Terms or modify the Service from time to time. For material changes,
        we may provide reasonable notice.
      </p>
      <p>
        These Terms are governed by the laws of India. Subject to applicable law, disputes will be
        subject to the jurisdiction of the courts located in Hyderabad, Telangana, India.
      </p>
      <p>If you have questions about these Terms, contact us at:</p>
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
        By using ManagerXP, you acknowledge that you have read and agreed to these Terms of
        Service.
      </p>
    </Section>
  </LegalPage>
);

export default TermsOfService;
