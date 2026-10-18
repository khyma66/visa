/** Small, edited resource guides. Dates are editorial reference checks, not legal reviews. */
export const GUIDE_REFERENCE_CHECKED_ON = '2026-10-18';
export const GUIDE_REFERENCE_CHECKED_LABEL = 'October 18, 2026';

type GuideReference = { title: string; url: string; publisher: string; purpose: string };
type GuideStep = { title: string; body: string; source?: number };
export type VisaGuide = {
  slug: string;
  visaType: string;
  title: string;
  description: string;
  introduction: string;
  distinction: string;
  steps: GuideStep[];
  questions: string[];
  communityContext: string;
  references: GuideReference[];
  furtherReading?: GuideReference[];
};

const visaValidity: GuideReference = {
  title: 'What the Visa Expiration Date Means',
  url: 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/visa-expiration-date.html',
  publisher: 'U.S. Department of State',
  purpose: 'Visa validity, admission and authorized stay explained.',
};

export const VISA_GUIDES: readonly VisaGuide[] = [
  {
    slug: 'h1b-petition-visa-status',
    visaType: 'H-1B',
    title: 'H-1B: separate your petition, visa and status questions',
    description: 'An H-1B orientation checklist: identify your stage, find official petition and visa resources, and prepare focused questions for your employer or adviser.',
    introduction: 'An H-1B discussion can jump between an employer’s petition, a visa appointment and permission to stay or work. Start by identifying which question you actually need answered. This guide helps you organize the facts before using official instructions or comparing community experiences.',
    distinction: 'Visa validity and admission are separate questions. The visa expiry date does not set your authorized stay. Check the official explanation and your own admission records.',
    steps: [
      {
        title: 'Name the stage you are asking about',
        body: 'Write down whether your question concerns an employer petition, a visa application abroad, or a current stay in the United States. The State Department’s temporary-worker page explains the petition and consular stages. It is a useful starting map, not a determination of your eligibility.',
        source: 0,
      },
      {
        title: 'Ask your employer to clarify the petition request',
        body: 'Ask what was requested, what was approved, and which dates and conditions apply to you. If you have heard “change of status,” “consular processing,” or “activation,” ask the employer’s immigration contact to explain precisely what that means for your case. Do not infer permission to start work from an appointment slot or another person’s story.',
      },
      {
        title: 'Use the instructions for the place where you will apply',
        body: 'For a visa application, follow the temporary-worker page to the relevant U.S. embassy or consulate. Check its current application, document, appointment and passport-return instructions. A completed DS-160, petition approval and visa issuance are different milestones; a community timeline cannot promise when you will reach the next one.',
        source: 0,
      },
      {
        title: 'Separate travel plans from status and work questions',
        body: 'List your proposed departure, return and work dates privately. Ask your employer’s qualified immigration adviser to check those plans against your actual records before relying on them. Use the official visa-validity explanation to understand which document answers which question.',
        source: 1,
      },
    ],
    questions: [
      'Which petition or application stage am I in, and what is still pending?',
      'Which record and date determine when I may begin this particular employment?',
      'Does the proposed travel affect any pending request or required next step?',
      'Which embassy’s current instructions apply to my appointment?',
    ],
    communityContext: 'When comparing H-1B accounts, look for the post date, consulate, petition stage and whether the person was inside or outside the United States. Similar job titles or appointment dates do not make two cases equivalent. A useful public question gives the stage and the issue without revealing an employer’s confidential documents or a receipt number.',
    references: [
      {
        title: 'Temporary Worker Visas',
        url: 'https://travel.state.gov/content/travel/en/us-visas/employment/temporary-worker-visas.html',
        publisher: 'U.S. Department of State',
        purpose: 'Petition-based visa applications, consular steps and required-document starting points.',
      },
      visaValidity,
    ],
    furtherReading: [
      {
        title: 'H-1B Specialty Occupations',
        url: 'https://www.uscis.gov/working-in-the-united-states/h-1b-specialty-occupations',
        publisher: 'USCIS',
        purpose: 'Open USCIS’s current H-1B guidance for petition requirements and updates.',
      },
    ],
  },
  {
    slug: 'f1-opt-planning-questions',
    visaType: 'F-1 / OPT',
    title: 'F-1 and OPT: a planning checklist for your DSO conversation',
    description: 'Prepare an F-1 or OPT question with your program stage, documents and proposed dates, then find the right school and official government resources.',
    introduction: 'A student-visa application, maintaining student status and practical training are different topics. Use this checklist to prepare a focused conversation with your designated school official (DSO), and to distinguish school instructions from other students’ experiences.',
    distinction: 'A visa expiry date does not determine your authorized stay. Read the admission-record explanation before assuming that a visa date, I-20 date and “D/S” mean the same thing.',
    steps: [
      {
        title: 'Start with your school and your current stage',
        body: 'For an initial student-visa application, the State Department describes school acceptance, SEVIS registration and Form I-20 before the visa application. For an existing student, write down whether the question concerns study, training, a school transfer or travel, so the DSO can direct you to the relevant process.',
        source: 0,
      },
      {
        title: 'Identify the training question precisely',
        body: 'Do you mean CPT, pre-completion OPT, post-completion OPT or a STEM OPT extension? Ask your DSO which category fits the proposed activity and which current USCIS instructions apply. A job offer, school recommendation and government authorization are not interchangeable labels. Ask what must be in place before your proposed start date.',
      },
      {
        title: 'Prepare a private timeline, not a public document upload',
        body: 'Have your program dates, relevant I-20, any application or authorization notices, and proposed job or travel dates available for your school’s secure process. Ask the DSO to identify deadlines, reporting duties and any gap that needs individual advice. Do not post your SEVIS ID, passport, I-94 or employment-authorization card in the community.',
      },
      {
        title: 'Check visa and travel instructions separately',
        body: 'If you need a visa appointment, read the student-visa page and the relevant embassy instructions. Discuss travel during a pending application or training period with your DSO before making plans. Check the official explanation of admission and visa validity; another student’s successful trip is not clearance for yours.',
        source: 1,
      },
    ],
    questions: [
      'Which training category, if any, applies to my program and proposed activity?',
      'What school recommendation and government authorization do I need, and in what order?',
      'Which filing, reporting and employment dates should I track for my circumstances?',
      'What should I confirm before changing schools, employers or travel plans?',
    ],
    communityContext: 'Compare accounts from the same training category and program stage. An initial OPT application is not a STEM extension, and a visa appointment is not an employment-authorization decision. For a useful question, share the category, general stage and exact point of confusion; keep identity and document numbers private.',
    references: [
      {
        title: 'Student Visa',
        url: 'https://travel.state.gov/content/travel/en/us-visas/study/student-visa.html',
        publisher: 'U.S. Department of State',
        purpose: 'School acceptance, I-20 and SEVIS context, student-visa applications and admission resources.',
      },
      visaValidity,
    ],
    furtherReading: [
      {
        title: 'Optional Practical Training (OPT) for F-1 Students',
        url: 'https://www.uscis.gov/working-in-the-united-states/students-and-exchange-visitors/optional-practical-training-opt-for-f-1-students',
        publisher: 'USCIS',
        purpose: 'Open USCIS’s current OPT eligibility and application instructions with your DSO.',
      },
      {
        title: 'Training Opportunities in the United States',
        url: 'https://studyinthestates.dhs.gov/students/training-opportunities-in-the-united-states',
        publisher: 'DHS · Study in the States',
        purpose: 'A starting point for identifying the training category to discuss with your school.',
      },
    ],
  },
  {
    slug: 'b1-b2-visitor-visa-preparation',
    visaType: 'B1/B2',
    title: 'B1/B2: organize your visitor-visa questions before applying',
    description: 'Find official visitor-visa and DS-160 instructions, distinguish an appointment from a visa decision, and prepare useful questions about your trip.',
    introduction: 'Visitor-visa discussions often mix trip purpose, form questions, interview logistics and admission. This guide helps you find the right official page and organize your own facts, without copying someone else’s answers or assuming their result predicts yours.',
    distinction: 'A valid visitor visa does not guarantee entry or a particular length of stay. Your admission record, rather than the visa’s expiry date, addresses your authorized stay.',
    steps: [
      {
        title: 'Describe the real purpose of the trip',
        body: 'The State Department distinguishes temporary business activities (B-1) from tourism and visits (B-2). Review its permitted and excluded activities. If your plans involve work, study or another activity you cannot clearly match to that guidance, get an authoritative answer before selecting a category.',
        source: 0,
      },
      {
        title: 'Use the DS-160 instructions for form questions',
        body: 'Prepare accurate information about your own travel, education and employment history. The official DS-160 FAQ explains form completion, signatures and corrections. Submitting the form is one application step; it does not by itself book an interview or result in a visa. Follow the consulate’s instructions if a submitted answer needs correction.',
        source: 1,
      },
      {
        title: 'Read the local appointment and document instructions',
        body: 'Start from the official visitor-visa page and follow its embassy or consulate link. Check current scheduling, payment and document requirements for that location. Organize the purpose, funding and intended duration of your trip. Do not treat an invitation letter, a prepared script or a previous applicant’s document list as a guarantee.',
        source: 0,
      },
      {
        title: 'Keep the outcome and travel stages separate',
        body: 'Track the appointment, any follow-up request, the visa decision and passport return as separate events. The State Department cautions against final travel plans before a visa is issued. Before travel, also read its explanation of visa validity and admission; neither a forum estimate nor an appointment confirmation establishes the outcome.',
        source: 0,
      },
    ],
    questions: [
      'Which permitted visitor activity matches the actual purpose of my trip?',
      'Which official instructions apply at the consulate where I plan to apply?',
      'Is my question about the DS-160, scheduling, a decision, or entry into the United States?',
      'If information has changed, where does the consulate explain how to correct it?',
    ],
    communityContext: 'Use interview experiences to understand logistics and the range of questions people report. Check the date and location, and distinguish a booked slot from an issued visa. Describe your own situation truthfully; a successful applicant’s wording, bank balance or family circumstances are not a reusable approval formula.',
    references: [
      {
        title: 'Visitor Visa',
        url: 'https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html',
        publisher: 'U.S. Department of State',
        purpose: 'Trip-purpose categories, application steps, documentation and travel cautions.',
      },
      {
        title: 'DS-160: Frequently Asked Questions',
        url: 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/forms/ds-160-online-nonimmigrant-visa-application/ds-160-faqs.html',
        publisher: 'U.S. Department of State',
        purpose: 'Official form-completion and correction instructions.',
      },
      visaValidity,
    ],
  },
];

export function visaGuide(slug: string): VisaGuide | undefined {
  return VISA_GUIDES.find((guide) => guide.slug === slug);
}

export function guideCommunityHref(guide: VisaGuide, experiences = false): string {
  return `${experiences ? '/experiences' : '/'}?visa=${encodeURIComponent(guide.visaType)}`;
}
