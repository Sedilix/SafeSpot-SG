/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ShieldCheck } from 'lucide-react';

// Written against Singapore's Personal Data Protection Act 2012 (PDPA) and
// the app's actual data flows. Keep it in step with the code: when a new
// data flow or service provider is added, update the relevant section and
// EFFECTIVE_DATE.
const EFFECTIVE_DATE = '6 October 2026';
const CONTACT_EMAIL = 'benlim631@gmail.com';

const Section: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section id={id} className="space-y-3">
    <h2 className="font-display text-ink text-2xl leading-tight font-bold">{title}</h2>
    <div className="text-ink-soft space-y-3 text-base leading-relaxed">{children}</div>
  </section>
);

const List: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ul className="list-disc space-y-1.5 pl-5">{children}</ul>
);

/** Public privacy policy at /privacy. */
export const PrivacyPolicy: React.FC = () => (
  <div className="bg-bg text-ink min-h-screen">
    <header className="border-line bg-surface/95 sticky top-0 z-40 border-b px-4 py-3 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <a href="/" className="font-display text-xl font-bold">SafeSpot.SG</a>
        <a href="/" className="btn btn-md btn-secondary">Back to app</a>
      </div>
    </header>

    <main className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-6">
      <div className="space-y-2">
        <div className="text-pine flex items-center gap-2">
          <ShieldCheck className="h-6 w-6" />
          <span className="section-kicker">Privacy Policy</span>
        </div>
        <h1 className="font-display text-4xl leading-tight font-bold">How SafeSpot.SG handles your personal data</h1>
        <p className="text-ink-soft text-sm font-semibold">Effective {EFFECTIVE_DATE}</p>
      </div>

      <div className="card space-y-2 p-5 text-base">
        <p className="font-semibold">In short</p>
        <List>
          <li>We use your location, health readings and contacts only to help you get found and to alert the people you choose.</li>
          <li>We do not sell your data, show advertising, or use tracking or analytics cookies.</li>
          <li>Anyone you send a live tracking link to can see the details shown on that page.</li>
          <li>SafeSpot.SG is not an emergency service. In a life-threatening emergency, call 995.</li>
        </List>
      </div>

      <Section id="who" title="1. Who we are">
        <p>
          SafeSpot.SG (“we”, “us”) provides the SafeSpot.SG web app and the SafeSpot SOS Garmin watch app. We are
          responsible for the personal data described here under Singapore's Personal Data Protection Act 2012 (PDPA).
        </p>
        <p>
          Our Data Protection Officer can be reached at{' '}
          <a className="text-pine font-semibold underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </Section>

      <Section id="collect" title="2. What we collect">
        <List>
          <li><strong>Account:</strong> your sign-in details from Google, your phone number (for SMS sign-in), or an anonymous guest ID.</li>
          <li><strong>Profile:</strong> your name, date of birth, address, saved places, a selfie if you add one, blood type and medical notes. Blood type and medical notes are health information; you choose whether to provide them.</li>
          <li><strong>Emergency contacts:</strong> names, relationships and phone numbers of people you add.</li>
          <li><strong>Location:</strong> your phone's GPS position when you use the app, and your watch's GPS position while the watch app is running.</li>
          <li><strong>Photos:</strong> pictures you take with “Pick Me Up Here!” to help identify where you are.</li>
          <li><strong>Watch data:</strong> heart rate, battery level, a randomly generated watch ID, and alert events (SOS, possible fall, abnormal heart rate, check-ins).</li>
          <li><strong>Voice:</strong> audio from voice commands, while you are using them.</li>
          <li><strong>Technical data:</strong> server logs (including IP address, request times and, for alerts, location and vitals), used to run and secure the service.</li>
        </List>
      </Section>

      <Section id="use" title="3. How we use it">
        <List>
          <li>To find and describe your location, including nearby landmarks and the nearest kerbside pick-up point.</li>
          <li>To send your location to the contacts you choose, and to alert them by SMS when you trigger an SOS or the watch detects a possible fall or abnormal heart rate.</li>
          <li>To show caregivers a live tracking page during an alert.</li>
          <li>To read information aloud and understand voice commands.</li>
          <li>To provide your account, keep the service secure and fix problems.</li>
        </List>
        <p>We do not use your data for advertising, sell it, or use it to make decisions about you other than raising the alerts described above.</p>
      </Section>

      <Section id="consent" title="4. Consent">
        <p>
          We collect, use and disclose your personal data with your consent, which you give by using the features
          described here. You can withdraw consent at any time by contacting us (see section 10) or by removing the
          information in the app; some features, such as alerts, will then stop working.
        </p>
        <p>
          <strong>Emergencies.</strong> The PDPA allows personal data to be collected, used and disclosed without consent
          where this is necessary to respond to an emergency that threatens someone's life, health or safety. When an
          alert is raised, we share your details with your chosen contacts on this basis.
        </p>
        <p>
          <strong>Other people's data.</strong> When you add emergency contacts, you confirm that they have agreed to be
          contacted by SafeSpot.SG and to receive your location and alert messages.
        </p>
      </Section>

      <Section id="share" title="5. Who we share it with">
        <p><strong>People you choose.</strong> Your emergency contacts receive SMS alerts and location links. A live tracking link shows your name, selfie, location, nearby landmarks, battery level, blood type and medical notes to <em>anyone who has the link</em>, so share it only with people you trust.</p>
        <p><strong>Service providers</strong> that process data on our behalf:</p>
        <List>
          <li><strong>Google Cloud and Firebase</strong> (hosting, sign-in, database): accounts and profiles are stored in Google's Singapore region.</li>
          <li><strong>Google Gemini AI</strong>: your photo and location are analysed to identify landmarks and describe where you are.</li>
          <li><strong>Google Maps Platform</strong>: addresses, nearby places, road snapping and Street View imagery for your location.</li>
          <li><strong>OneMap (Singapore Land Authority)</strong>: address search and routing.</li>
          <li><strong>Twilio</strong>: sends SMS alerts to your contacts and SMS sign-in codes.</li>
          <li><strong>Speechmatics</strong>: speech recognition and text-to-speech.</li>
          <li><strong>Garmin</strong>: the watch app's messages travel through the Garmin Connect app on your phone.</li>
        </List>
        <p>We may also disclose personal data where the law requires it.</p>
      </Section>

      <Section id="transfer" title="6. Transfers outside Singapore">
        <p>
          Some providers above (for example Twilio, Speechmatics and parts of Google's services) may process data outside
          Singapore. Where we transfer personal data overseas, we take steps to ensure it receives a standard of
          protection comparable to the PDPA, including relying on these providers' contractual data protection
          commitments.
        </p>
      </Section>

      <Section id="device" title="7. Data stored on your device">
        <p>
          The app saves your settings, profile, emergency contacts, last known location and onboarding progress in your
          browser's local storage and in cookies on this site, so it keeps working if your connection drops. These are
          essential for the app to work; we do not use tracking or analytics cookies. Clearing this site's data in your
          browser removes them.
        </p>
      </Section>

      <Section id="retention" title="8. How long we keep it">
        <List>
          <li><strong>Account and profile:</strong> until you ask us to delete them.</li>
          <li><strong>Watch pairing:</strong> until you unpair the watch in your profile.</li>
          <li><strong>Live watch status:</strong> held in server memory only and cleared when the server restarts.</li>
          <li><strong>Alert and tracking records:</strong> kept for safety follow-up until you ask us to delete them; we periodically remove records that are no longer needed.</li>
          <li><strong>Server logs:</strong> normally deleted after 30 days.</li>
        </List>
        <p>We stop keeping personal data once it is no longer needed for the purposes above or for legal or business reasons.</p>
      </Section>

      <Section id="security" title="9. How we protect it">
        <p>
          Data is encrypted in transit (HTTPS). Profiles can only be read by their owner, watch pairing requires
          signing in, and the watch app authenticates to our server. We apply reasonable security arrangements, but no
          system is completely secure.
        </p>
        <p>
          If a data breach is likely to cause you significant harm, or affects 500 or more people, we will notify the
          Personal Data Protection Commission and, where required, the affected individuals, as the PDPA requires.
        </p>
      </Section>

      <Section id="rights" title="10. Your rights">
        <p>You can ask us to:</p>
        <List>
          <li>give you a copy of your personal data and tell you how it has been used or disclosed in the past year;</li>
          <li>correct inaccurate or incomplete personal data;</li>
          <li>stop using your personal data (withdraw consent), or delete it.</li>
        </List>
        <p>
          Email <a className="text-pine font-semibold underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          We may need to verify your identity, and we aim to respond within 30 days. You can update most of your
          details yourself in the app's Profile.
        </p>
        <p>
          If you are not satisfied with our response, you may contact the Personal Data Protection Commission at{' '}
          <a className="text-pine font-semibold underline" href="https://www.pdpc.gov.sg" target="_blank" rel="noopener noreferrer">www.pdpc.gov.sg</a>.
        </p>
      </Section>

      <Section id="emergency" title="11. Not an emergency service">
        <p>
          SafeSpot.SG helps you share your location and alert people you know. It does not contact the Singapore Civil
          Defence Force or the police for you, and alerts depend on your phone, network and watch connection. In a
          life-threatening emergency, call 995.
        </p>
      </Section>

      <Section id="changes" title="12. Changes to this policy">
        <p>
          We may update this policy as the service changes. The effective date at the top shows when it last changed;
          significant changes will be highlighted in the app.
        </p>
      </Section>
    </main>

    <footer className="border-line text-ink-soft border-t px-4 py-6 text-center text-sm">
      SafeSpot.SG • <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
    </footer>
  </div>
);
