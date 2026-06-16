import type { Category, FieldDefinition, FixtureDefinition, StepDefinition } from "./types";

const options = {
  yesNo: ["Yes", "No"],
  states: ["California", "Colorado", "Florida", "Illinois", "New York", "Texas", "Washington"],
  countries: ["United States", "Canada", "Mexico", "United Kingdom", "Other"],
};

const field = (
  id: string,
  label: string,
  type: FieldDefinition["type"] = "text",
  extra: Partial<FieldDefinition> = {},
): FieldDefinition => ({ id, label, type, ...extra });

const personFields = (prefix = "applicant"): FieldDefinition[] => [
  field(`${prefix}.firstName`, "Legal first name", "text", { required: true, autocomplete: "given-name" }),
  field(`${prefix}.middleName`, "Middle name (optional)", "text", { autocomplete: "additional-name" }),
  field(`${prefix}.lastName`, "Legal last name", "text", { required: true, autocomplete: "family-name" }),
  field(`${prefix}.suffix`, "Suffix", "select", { options: ["", "Jr.", "Sr.", "II", "III"] }),
  field(`${prefix}.preferredName`, "Preferred name"),
  field(`${prefix}.birthDate`, "Date of birth", "date", { required: true, autocomplete: "bday" }),
  field(`${prefix}.email`, "Email address", "email", { required: true, autocomplete: "email" }),
  field(`${prefix}.phone`, "Primary phone", "tel", { required: true, autocomplete: "tel" }),
  field(`${prefix}.alternatePhone`, "Alternate phone", "tel"),
  field(`${prefix}.contactMethod`, "Preferred contact method", "radio", { required: true, options: ["Email", "Phone", "Text"] }),
];

const addressFields = (prefix = "address"): FieldDefinition[] => [
  field(`${prefix}.search`, "Find an address", "text", { placeholder: "Try 1840 Juniper Avenue", help: "Suggestions use local fictional addresses only." }),
  field(`${prefix}.line1`, "Street address", "text", { required: true, autocomplete: "address-line1" }),
  field(`${prefix}.line2`, "Apartment, suite, or unit", "text", { autocomplete: "address-line2" }),
  field(`${prefix}.city`, "City", "text", { required: true, autocomplete: "address-level2" }),
  field(`${prefix}.state`, "State", "select", { required: true, autocomplete: "address-level1", options: options.states }),
  field(`${prefix}.postalCode`, "ZIP code", "text", { required: true, autocomplete: "postal-code" }),
  field(`${prefix}.country`, "Country", "select", { required: true, autocomplete: "country-name", options: options.countries }),
  field(`${prefix}.since`, "Living at this address since", "date"),
  field(`${prefix}.differentMailing`, "Mailing address is different", "checkbox"),
];

const historyFields = (kind: Category): FieldDefinition[] => {
  if (kind === "jobs") {
    return [
      field("history.employer", "Most recent employer", "text", { required: true, autocomplete: "organization" }),
      field("history.title", "Job title", "text", { required: true, autocomplete: "organization-title" }),
      field("history.start", "Employment start date", "date", { required: true }),
      field("history.end", "Employment end date", "date"),
      field("history.current", "I currently work here", "checkbox"),
      field("history.supervisor", "Supervisor name"),
      field("history.phone", "Employer phone", "tel"),
      field("history.duties", "Responsibilities and achievements", "textarea", { required: true }),
      field("history.reason", "Reason for leaving"),
      field("history.contact", "May we contact this employer?", "radio", { options: options.yesNo }),
      field("education.school", "School or institution", "text", { required: true }),
      field("education.degree", "Degree or credential", "select", { options: ["High school", "Associate", "Bachelor's", "Master's", "Doctorate", "Certificate"] }),
      field("education.field", "Field of study"),
      field("education.graduation", "Graduation date", "date"),
    ];
  }
  if (kind === "tax") {
    return [
      field("income.wages", "Wages and salary", "number", { required: true }),
      field("income.withholding", "Federal tax withheld", "number"),
      field("income.interest", "Taxable interest", "number"),
      field("income.dividends", "Ordinary dividends", "number"),
      field("income.business", "Net business income", "number"),
      field("income.unemployment", "Unemployment compensation", "number"),
      field("income.retirement", "Taxable retirement distributions", "number"),
      field("income.other", "Other income", "number"),
      field("documents.w2", "W-2 wage statement", "file"),
      field("documents.1099", "1099 income statement", "file"),
      field("deductions.educator", "Educator expenses", "number"),
      field("deductions.studentLoan", "Student loan interest", "number"),
      field("deductions.charity", "Charitable contributions", "number"),
      field("deductions.medical", "Qualified medical expenses", "number"),
    ];
  }
  if (kind === "insurance") {
    return [
      field("incident.date", "Incident date", "date", { required: true }),
      field("incident.time", "Approximate time", "text", { required: true, placeholder: "3:30 PM" }),
      field("incident.location", "Incident location", "text", { required: true }),
      field("incident.description", "Describe what happened", "textarea", { required: true }),
      field("incident.police", "Was a report made?", "radio", { required: true, options: options.yesNo }),
      field("incident.reportNumber", "Synthetic report number", "text", { showWhen: { field: "incident.police", value: "Yes" } }),
      field("incident.injuries", "Were there injuries?", "radio", { required: true, options: options.yesNo }),
      field("incident.emergency", "Was emergency care provided?", "radio", { options: options.yesNo, showWhen: { field: "incident.injuries", value: "Yes" } }),
      field("damage.summary", "Damaged property or expenses", "textarea", { required: true }),
      field("damage.estimate", "Estimated amount", "number"),
      field("witness.name", "Witness name"),
      field("witness.phone", "Witness phone", "tel"),
      field("documents.photos", "Photos or supporting documents", "file"),
      field("documents.receipts", "Receipts or estimates", "file"),
    ];
  }
  return [
    field("household.count", "Number of people in household", "number", { required: true }),
    field("household.member1Name", "Household member 1 full name", "text", { required: true }),
    field("household.member1Relationship", "Relationship to applicant", "select", { options: ["Self", "Spouse", "Child", "Parent", "Roommate", "Other"] }),
    field("household.member1BirthDate", "Household member 1 birth date", "date"),
    field("household.member1Income", "Household member 1 monthly income", "number"),
    field("household.addMember", "Include another household member", "checkbox"),
    field("household.member2Name", "Household member 2 full name", "text", { showWhen: { field: "household.addMember", value: "true" } }),
    field("household.member2Relationship", "Household member 2 relationship", "select", { options: ["Spouse", "Child", "Parent", "Roommate", "Other"], showWhen: { field: "household.addMember", value: "true" } }),
    field("income.employment", "Monthly employment income", "number", { required: true }),
    field("income.selfEmployment", "Monthly self-employment income", "number"),
    field("income.benefits", "Other monthly benefits", "number"),
    field("expenses.rent", "Monthly rent or mortgage", "number", { required: true }),
    field("expenses.utilities", "Monthly utility costs", "number"),
    field("documents.proof", "Proof of circumstances", "file"),
  ];
};

const reviewFields = (category: Category): FieldDefinition[] => [
  field("consent.accurate", "I certify this synthetic information is accurate for testing", "checkbox", { required: true }),
  field("consent.fakeOnly", "I confirm I entered fake data only", "checkbox", { required: true }),
  field("consent.contact", "I understand no organization will contact me", "checkbox", { required: true }),
  field("signature.name", "Type your full name as a synthetic signature", "text", { required: true }),
  field("signature.date", "Certification date", "date", { required: true }),
  field("signature.notes", `${category === "jobs" ? "Applicant" : "Filer"} notes (optional)`, "textarea"),
];

type Theme = FixtureDefinition["theme"];
type Navigation = FixtureDefinition["navigation"];

interface Variant {
  slug: string;
  name: string;
  organization: string;
  summary: string;
  theme: Theme;
  navigation: Navigation;
  accent: string;
  secondary: string;
  badge: string;
  steps: Array<[string, string, string]>;
}

const variants: Record<Category, Variant[]> = {
  jobs: [
    { slug: "corporate-talent", name: "Corporate talent application", organization: "Northstar Systems", summary: "A structured enterprise application with source, work history, and voluntary disclosures.", theme: "enterprise", navigation: "sidebar", accent: "#5b2c83", secondary: "#efe7f5", badge: "Candidate home", steps: [["source", "How did you hear about us?", "Source and account"], ["identity", "My information", "Personal information"], ["experience", "My experience", "Resume and history"], ["questions", "Application questions", "Role eligibility"], ["disclosures", "Voluntary disclosures", "Optional information"], ["review", "Review and submit", "Final review"]] },
    { slug: "greenhouse-technical", name: "Technical role application", organization: "Juniper Stack", summary: "A concise recruiting workflow with portfolio links and technical screening questions.", theme: "minimal", navigation: "top", accent: "#087f5b", secondary: "#e8f7f1", badge: "Engineering / Platform", steps: [["role", "Senior frontend engineer", "Role overview"], ["contact", "Candidate details", "Contact information"], ["resume", "Resume and links", "Professional profile"], ["screening", "Team questions", "Technical screening"], ["diversity", "Demographic survey", "Optional survey"], ["finish", "Check your application", "Review"]] },
    { slug: "public-service", name: "Public service employment", organization: "CivicWorks Personnel", summary: "A qualification-heavy government-style application with eligibility and narrative responses.", theme: "civic", navigation: "rail", accent: "#174ea6", secondary: "#e8f0fe", badge: "Vacancy CW-26-104", steps: [["eligibility", "Eligibility", "Who may apply"], ["profile", "Applicant profile", "Identity and contact"], ["resume", "Federal-style resume", "Employment history"], ["assessment", "Qualifications assessment", "Experience ratings"], ["documents", "Required documents", "Supporting evidence"], ["certify", "Certify application", "Review and certify"]] },
    { slug: "retail-hourly", name: "Retail team member application", organization: "Market Harbor", summary: "An hourly-worker application focused on availability, location, experience, and scheduling.", theme: "retail", navigation: "question", accent: "#d83a31", secondary: "#fff0df", badge: "Store 184 / Sales floor", steps: [["location", "Choose your store", "Location"], ["basics", "Let's get to know you", "About you"], ["availability", "When can you work?", "Schedule"], ["experience", "Tell us about your experience", "Work history"], ["scenarios", "A few work scenarios", "Job fit"], ["ready", "You're almost done", "Review"]] },
    { slug: "engineering-screen", name: "Senior engineering screening", organization: "Copperline Labs", summary: "A detailed technical application with architecture, leadership, and work authorization questions.", theme: "foundry", navigation: "sidebar", accent: "#f97316", secondary: "#fff3e8", badge: "Fixture Foundry original", steps: [["identity", "About you", "Applicant details"], ["address", "Contact and address", "Contact"], ["career", "Career timeline", "Experience"], ["technical", "Technical deep dive", "Screening"], ["leadership", "Leadership and collaboration", "Ways of working"], ["review", "Review and certify", "Final review"]] },
  ],
  tax: [
    { slug: "individual-return", name: "Individual income tax interview", organization: "LedgerLeaf", summary: "A guided interview covering household, income, adjustments, credits, and review.", theme: "interview", navigation: "question", accent: "#006d77", secondary: "#e3f6f5", badge: "2025 federal return", steps: [["welcome", "First, let's understand your tax year", "Getting started"], ["household", "Tell us about your household", "You and your family"], ["income", "What income did you receive?", "Income"], ["deductions", "Let's look for deductions", "Tax breaks"], ["credits", "Check your credit eligibility", "Credits"], ["summary", "Your return summary", "Review"]] },
    { slug: "self-employed", name: "Independent business income", organization: "LedgerLeaf Pro", summary: "A Schedule C-inspired workflow for revenue, expenses, assets, and home-office use.", theme: "workspace", navigation: "checklist", accent: "#253551", secondary: "#e9edf3", badge: "Business workspace", steps: [["business", "Business profile", "Business basics"], ["revenue", "Income received", "Revenue"], ["expenses", "Business expenses", "Expense categories"], ["assets", "Vehicles and equipment", "Assets"], ["office", "Home office and other deductions", "Deductions"], ["review", "Business income summary", "Review"]] },
    { slug: "credit-eligibility", name: "Tax credit eligibility check", organization: "BrightCredit Guide", summary: "A household and dependent interview for common refundable and education credits.", theme: "interview", navigation: "question", accent: "#7c3aed", secondary: "#f2ebff", badge: "Credit finder", steps: [["intro", "Let's find credits you may qualify for", "Introduction"], ["household", "Who lived with you?", "Household"], ["children", "Children and dependents", "Dependents"], ["work", "Work and earned income", "Income"], ["education", "Education and care expenses", "Expenses"], ["results", "Potential credit results", "Review"]] },
    { slug: "state-return", name: "State income tax return", organization: "Cedar Revenue Online", summary: "A fictional state return with residency, additions, subtractions, payments, and review.", theme: "civic", navigation: "rail", accent: "#164e63", secondary: "#e4f3f6", badge: "Tax year 2025", steps: [["residency", "Residency", "Filing requirement"], ["federal", "Federal return information", "Federal amounts"], ["adjustments", "State additions", "Additions"], ["subtractions", "State subtractions and credits", "Subtractions"], ["payments", "Payments and withholding", "Payments"], ["declaration", "Declaration", "Review and file"]] },
    { slug: "document-organizer", name: "Tax document intake organizer", organization: "FileNest Tax", summary: "A document-first organizer for wages, investments, property, deductions, and questions.", theme: "workspace", navigation: "checklist", accent: "#b45309", secondary: "#fff4dc", badge: "Organizer / 2025", steps: [["profile", "Organizer profile", "Client details"], ["wages", "Wages and employment", "W-2 documents"], ["investments", "Interest and investments", "1099 documents"], ["property", "Property and business", "Ownership"], ["deductions", "Deductions and life changes", "Deductions"], ["missing", "Missing items and questions", "Checklist review"]] },
  ],
  insurance: [
    { slug: "auto-collision", name: "Auto collision claim", organization: "Roadwise Mutual", summary: "A first-notice-of-loss workflow for vehicles, drivers, damage, injuries, and witnesses.", theme: "claims", navigation: "top", accent: "#0b63ce", secondary: "#e8f2ff", badge: "Report a new claim", steps: [["safety", "Are you safe?", "Immediate needs"], ["policy", "Find your policy", "Policy details"], ["collision", "What happened?", "Collision details"], ["vehicles", "Vehicles and drivers", "People involved"], ["damage", "Damage, injuries, and photos", "Loss details"], ["confirm", "Confirm your report", "Review"]] },
    { slug: "home-damage", name: "Home property damage claim", organization: "Hearthline Assurance", summary: "A property claim for loss location, rooms, damaged items, emergency mitigation, and vendors.", theme: "claims", navigation: "rail", accent: "#9a3412", secondary: "#fff0e8", badge: "Property claim center", steps: [["emergency", "Protect your home first", "Safety"], ["property", "Property and policy", "Loss location"], ["cause", "Cause of damage", "Event"], ["rooms", "Rooms and damaged items", "Inventory"], ["repairs", "Emergency repairs and vendors", "Mitigation"], ["review", "Review property claim", "Submit report"]] },
    { slug: "health-reimbursement", name: "Health reimbursement request", organization: "Wellpath Member Services", summary: "A member reimbursement form for providers, services, expenses, and supporting documents.", theme: "minimal", navigation: "top", accent: "#047857", secondary: "#e8f8f1", badge: "Member reimbursement", steps: [["member", "Member information", "Member"], ["provider", "Provider information", "Provider"], ["services", "Services received", "Care details"], ["charges", "Charges and other coverage", "Expenses"], ["receipts", "Upload itemized documents", "Documents"], ["attest", "Attestation and review", "Review"]] },
    { slug: "travel-claim", name: "Travel protection claim", organization: "Wayfarer Cover", summary: "A trip disruption claim covering itinerary, cause, expenses, refunds, and companions.", theme: "workspace", navigation: "checklist", accent: "#0369a1", secondary: "#e8f5fb", badge: "Trip WFR-2084", steps: [["trip", "Your protected trip", "Itinerary"], ["traveler", "Travelers", "People"], ["event", "Reason for your claim", "Disruption"], ["expenses", "Claimed expenses", "Costs"], ["refunds", "Refunds and supporting files", "Recovery"], ["review", "Claim package", "Review"]] },
    { slug: "workers-incident", name: "Workplace incident report", organization: "CommonGround Casualty", summary: "An employee incident intake with employer, duties, event details, treatment, and restrictions.", theme: "civic", navigation: "rail", accent: "#374151", secondary: "#edf0f3", badge: "Employee incident form", steps: [["employee", "Employee information", "Worker"], ["employer", "Employer and job duties", "Employment"], ["incident", "Injury or illness", "Incident"], ["medical", "Medical treatment", "Care"], ["work", "Time away and restrictions", "Work status"], ["certification", "Employee certification", "Review"]] },
  ],
  benefits: [
    { slug: "unemployment", name: "Unemployment assistance", organization: "WorkBridge Services", summary: "A benefits intake covering separation, employers, availability, and weekly earnings.", theme: "civic", navigation: "rail", accent: "#1d4ed8", secondary: "#e9f0ff", badge: "New claimant application", steps: [["eligibility", "Before you apply", "Eligibility"], ["identity", "Claimant information", "Identity"], ["employment", "Recent employers", "Employment"], ["separation", "Last day and separation", "Job separation"], ["availability", "Able and available for work", "Work availability"], ["certify", "Claim certification", "Review"]] },
    { slug: "food-support", name: "Food assistance eligibility", organization: "Nourish Access", summary: "A household eligibility interview covering members, income, shelter, utilities, and resources.", theme: "eligibility", navigation: "question", accent: "#397445", secondary: "#edf6e9", badge: "Food support screener", steps: [["start", "A few questions before we begin", "Screening"], ["people", "Who buys and prepares food together?", "Household"], ["income", "Money coming into the home", "Income"], ["expenses", "Housing and care costs", "Expenses"], ["resources", "Resources and special circumstances", "Resources"], ["review", "Review your household", "Application review"]] },
    { slug: "housing-support", name: "Housing assistance application", organization: "HomePath Community", summary: "A housing waitlist application with household, accessibility, income, and preferences.", theme: "eligibility", navigation: "checklist", accent: "#7c2d12", secondary: "#fff0e5", badge: "Community housing waitlist", steps: [["program", "Program and property choices", "Preferences"], ["head", "Head of household", "Primary applicant"], ["members", "Household members", "Household"], ["housing", "Current housing situation", "Housing history"], ["income", "Income, assets, and accessibility", "Eligibility"], ["review", "Waitlist application review", "Certification"]] },
    { slug: "disability-intake", name: "Disability support intake", organization: "AbilityPath Services", summary: "A non-medical intake covering work impact, providers, daily activities, and documentation.", theme: "minimal", navigation: "top", accent: "#5b21b6", secondary: "#f1ebff", badge: "Support intake", steps: [["contact", "Contact and communication", "About you"], ["condition", "Conditions affecting daily life", "Health overview"], ["work", "Work and education history", "Background"], ["activities", "Daily activities and support", "Daily life"], ["providers", "Providers and documents", "Records"], ["review", "Review your intake", "Certification"]] },
    { slug: "childcare-support", name: "Family and childcare support", organization: "FamilySpring", summary: "A family application covering guardians, children, care schedules, providers, and income.", theme: "retail", navigation: "question", accent: "#c0266d", secondary: "#fff0f7", badge: "Child care assistance", steps: [["family", "Tell us about your family", "Family"], ["children", "Children needing care", "Children"], ["schedule", "When is care needed?", "Care schedule"], ["provider", "Child care provider", "Provider"], ["income", "Work, school, and household income", "Eligibility"], ["review", "Family application review", "Review"]] },
  ],
};

function customFields(category: Category, slug: string): FieldDefinition[] {
  const common = [
    field("details.reason", "What are you applying for?", "textarea", { required: true }),
    field("details.startDate", "Requested or available start date", "date"),
    field("details.language", "Preferred language", "select", { options: ["English", "Spanish", "French", "Mandarin", "Other"] }),
    field("details.accommodation", "Do you need an accessibility accommodation?", "radio", { options: options.yesNo }),
    field("details.accommodationNotes", "Describe the accommodation needed", "textarea", { showWhen: { field: "details.accommodation", value: "Yes" } }),
    field("details.referral", "How did you hear about this service?", "select", { options: ["Search engine", "Friend or family", "Community organization", "Employer", "Other"] }),
  ];
  if (category === "jobs") {
    common.push(
      field("screen.workAuthorization", "Authorized to work in this country?", "radio", { required: true, options: options.yesNo }),
      field("screen.sponsorship", "Will you require future sponsorship?", "radio", { required: true, options: options.yesNo }),
      field("screen.portfolio", "Portfolio or professional profile URL", "text", { autocomplete: "url" }),
      field("screen.salary", "Expected annual compensation", "number"),
      field("screen.remote", "Preferred work arrangement", "select", { options: ["On-site", "Hybrid", "Remote"] }),
      field("screen.narrative", slug.includes("technical") || slug.includes("engineering") ? "Describe a difficult technical decision" : "Why are you interested in this role?", "textarea", { required: true }),
    );
  } else if (category === "tax") {
    common.push(
      field("tax.filingStatus", "Expected filing status", "select", { required: true, options: ["Single", "Married filing jointly", "Married filing separately", "Head of household", "Qualifying surviving spouse"] }),
      field("tax.fullYearResident", "Full-year resident?", "radio", { required: true, options: options.yesNo }),
      field("tax.dependents", "Will you claim dependents?", "radio", { required: true, options: options.yesNo }),
      field("tax.dependentName", "Dependent full name", "text", { showWhen: { field: "tax.dependents", value: "Yes" } }),
      field("tax.syntheticId", "Synthetic taxpayer ID (use 000-00-0000)", "text", { required: true, help: "Never enter a real government identifier." }),
      field("tax.priorReturn", "Did you file last year?", "radio", { options: options.yesNo }),
    );
  } else if (category === "insurance") {
    common.push(
      field("policy.syntheticNumber", "Synthetic policy number", "text", { required: true, placeholder: "TEST-PL-000123" }),
      field("policy.holder", "Named policyholder", "text", { required: true }),
      field("policy.relationship", "Relationship to policyholder", "select", { options: ["Self", "Spouse", "Child", "Employee", "Other"] }),
      field("policy.otherCoverage", "Is other coverage available?", "radio", { options: options.yesNo }),
      field("policy.safe", "Is everyone currently safe?", "radio", { required: true, options: options.yesNo }),
      field("policy.callback", "Best callback window", "select", { options: ["Morning", "Afternoon", "Evening"] }),
    );
  } else {
    common.push(
      field("benefit.currentlyReceiving", "Currently receiving related assistance?", "radio", { required: true, options: options.yesNo }),
      field("benefit.urgentNeed", "Is there an urgent health or safety need?", "radio", { required: true, options: options.yesNo }),
      field("benefit.explanation", "Explain your current circumstances", "textarea", { required: true }),
      field("benefit.residency", "Residency status for this fictional application", "select", { required: true, options: ["Citizen", "Qualified resident", "Temporary resident", "Prefer not to answer"] }),
      field("benefit.syntheticCase", "Synthetic case number (optional)", "text", { placeholder: "TEST-CASE-0042" }),
      field("benefit.interpreter", "Interpreter requested", "checkbox"),
    );
  }
  return common;
}

const additionalFields = (): FieldDefinition[] => [
      field("alternate.name", "Alternate contact full name"),
      field("alternate.relationship", "Relationship to you"),
      field("alternate.email", "Alternate contact email", "email"),
      field("alternate.phone", "Alternate contact phone", "tel"),
      field("previous.line1", "Previous street address"),
      field("previous.city", "Previous city"),
      field("previous.state", "Previous state", "select", { options: options.states }),
      field("previous.postalCode", "Previous ZIP code"),
      field("additional.documents", "Additional supporting files", "file"),
      field("additional.notes", "Anything else we should know?", "textarea"),
];

const nativeFieldSets: Record<string, string[]> = {
  "corporate-talent": ["Candidate source", "Employee referral name", "Current company", "Notice period", "Relocation preference", "Conflict of interest disclosure"],
  "greenhouse-technical": ["Resume or CV", "Git repository URL", "Portfolio URL", "Production React experience", "Most complex interface shipped", "Interview accommodation"],
  "public-service": ["Vacancy eligibility path", "Veterans preference category", "Highest federal grade held", "Hours worked per week", "Specialized experience narrative", "Required transcript"],
  "retail-hourly": ["Preferred store location", "Earliest shift start", "Latest shift end", "Weekend availability", "Customer scenario response", "Reliable transportation"],
  "engineering-screen": ["Primary programming language", "System design example", "Accessibility testing approach", "Incident leadership example", "Mentoring experience", "Preferred engineering environment"],
  "individual-return": ["Filing status", "Prior-year return filed", "W-2 count", "Interest statements received", "Itemized deductions considered", "Estimated refund preference"],
  "self-employed": ["Business legal name", "Business activity", "Accounting method", "Gross receipts", "Vehicle business miles", "Home office square footage"],
  "credit-eligibility": ["Dependent residency months", "Dependent student status", "Childcare expenses", "Education tuition paid", "Earned income amount", "Potential credit result"],
  "state-return": ["Residency start date", "County of residence", "Federal adjusted gross income", "State additions", "State tax withheld", "Estimated payments"],
  "document-organizer": ["W-2 documents expected", "1099 forms expected", "Brokerage statements", "Property tax statement", "Charitable receipt bundle", "Missing document notes"],
  "auto-collision": ["Vehicle year make and model", "Driver at time of loss", "Collision direction", "Towing company", "Rental vehicle needed", "Damage photo upload"],
  "home-damage": ["Property habitability", "Cause of loss", "Affected room", "Damaged item description", "Emergency mitigation vendor", "Temporary lodging needed"],
  "health-reimbursement": ["Member plan number", "Patient relationship", "Provider identifier", "Service procedure description", "Amount paid by member", "Itemized bill or EOB"],
  "travel-claim": ["Booking confirmation", "Trip departure date", "Disruption reason", "Nonrefundable expense", "Refund already received", "Carrier notice upload"],
  "workers-incident": ["Employer location", "Job duties at incident", "Body part affected", "Treating provider", "Work restriction", "First day missed"],
  unemployment: ["Claimant work state", "Last employer", "Separation reason", "Final day worked", "Weekly availability", "Expected severance"],
  "food-support": ["Food purchasing group", "Household groceries shared", "Monthly earned income", "Monthly rent", "Heating or cooling expense", "Interview language"],
  "housing-support": ["Housing program choice", "Preferred property area", "Current homelessness risk", "Bedroom size requested", "Accessibility unit needed", "Waitlist preference reason"],
  "disability-intake": ["Primary condition", "Condition onset date", "Daily activity affected", "Last day worked", "Treating provider", "Communication accommodation"],
  "childcare-support": ["Child needing care", "Child age", "Days care is needed", "Care start and end time", "Preferred provider", "Guardian work or school schedule"],
};

function nativeFields(variant: Variant, stepIndex: number): FieldDefinition[] {
  const labels = nativeFieldSets[variant.slug];
  const first = labels[stepIndex % labels.length];
  const second = labels[(stepIndex + 2) % labels.length];
  return [
    field(`${variant.slug}.${variant.steps[stepIndex][0]}.primary`, first, first.toLowerCase().includes("upload") || first.toLowerCase().includes("document") ? "file" : first.toLowerCase().includes("date") || first.toLowerCase().includes("day worked") ? "date" : "text", { required: true }),
    field(`${variant.slug}.${variant.steps[stepIndex][0]}.detail`, second, second.toLowerCase().includes("needed") || second.toLowerCase().includes("shared") ? "radio" : second.toLowerCase().includes("amount") || second.toLowerCase().includes("income") || second.toLowerCase().includes("expense") ? "number" : "text", { options: second.toLowerCase().includes("needed") || second.toLowerCase().includes("shared") ? options.yesNo : undefined }),
  ];
}

function baseFieldsForStep(category: Category, stepId: string, stepIndex: number): FieldDefinition[] {
  const id = stepId.toLowerCase();
  if (/identity|profile|contact|member|employee|claimant|traveler|head|family|basics/.test(id)) return personFields();
  if (/address|property|location|residency|housing/.test(id)) return addressFields();
  if (/history|experience|career|employment|income|revenue|expenses|deductions|work|assessment|services|charges|damage|incident|collision|cause|rooms|medical/.test(id)) return historyFields(category);
  if (/review|finish|ready|confirm|certif|attest|summary|results|declaration|missing/.test(id)) return reviewFields(category);
  if (/document|receipt|refund|provider|assets|office|questions|screen|eligibility|availability|schedule|children|people|resources|credits|federal|adjustment|subtraction|payment|trip|event|policy|safety|emergency|program/.test(id)) return customFields(category, stepId);
  return [personFields(), addressFields(), customFields(category, stepId), historyFields(category), additionalFields(), reviewFields(category)][stepIndex];
}

function scopeFields(stepId: string, fields: FieldDefinition[]): FieldDefinition[] {
  const idMap = new Map(fields.map((item) => [item.id, `${stepId}.${item.id}`]));
  return fields.map((item) => ({
    ...item,
    id: idMap.get(item.id)!,
    showWhen: item.showWhen ? { ...item.showWhen, field: idMap.get(item.showWhen.field) ?? `${stepId}.${item.showWhen.field}` } : undefined,
  }));
}

function makeSteps(category: Category, variant: Variant): StepDefinition[] {
  return variant.steps.map(([id, title, eyebrow], index) => ({
    id,
    title,
    eyebrow,
    description: [
      `Complete the ${title.toLowerCase()} section for this fictional ${variant.organization} workflow.`,
      "Use synthetic details only. Your progress stays in this browser.",
      "Questions in this section follow the terminology and grouping used by this service style.",
    ][index % 3],
    fields: [...nativeFields(variant, index), ...scopeFields(id, baseFieldsForStep(category, id, index))],
  }));
}

export const fixtures: FixtureDefinition[] = (Object.entries(variants) as Array<[Category, typeof variants[Category]]>)
  .flatMap(([category, entries]) => entries.map((variant) => ({
    slug: variant.slug,
    category,
    name: variant.name,
    organization: variant.organization,
    summary: variant.summary,
    accent: variant.accent,
    secondary: variant.secondary,
    theme: variant.theme,
    navigation: variant.navigation,
    badge: variant.badge,
    steps: makeSteps(category, variant),
  })));

export const fakeProfiles = {
  "Salaried software engineer": {
    "applicant.firstName": "Maya", "applicant.lastName": "Chen", "applicant.email": "maya.chen@example.test",
    "applicant.phone": "202-555-0148", "address.line1": "1840 Juniper Avenue", "address.city": "Cedar Falls",
    "address.state": "Washington", "address.postalCode": "98104", "address.country": "United States",
    "history.employer": "Fictional Orbit Software", "history.title": "Senior Software Engineer",
  },
  "Hourly retail worker": {
    "applicant.firstName": "Jordan", "applicant.lastName": "Rivera", "applicant.email": "jordan.rivera@example.test",
    "applicant.phone": "303-555-0192", "address.line1": "72 Market Street", "address.city": "Northfield",
    "address.state": "Colorado", "address.postalCode": "80205", "address.country": "United States",
    "history.employer": "Sample Street Market", "history.title": "Sales Associate",
  },
  "Self-employed contractor": {
    "applicant.firstName": "Avery", "applicant.lastName": "Brooks", "applicant.email": "avery.brooks@example.test",
    "applicant.phone": "512-555-0177", "address.line1": "905 Mockingbird Lane", "address.city": "Austin",
    "address.state": "Texas", "address.postalCode": "78702", "address.country": "United States",
    "income.business": "68400",
  },
  "Parent with dependents": {
    "applicant.firstName": "Samira", "applicant.lastName": "Patel", "applicant.email": "samira.patel@example.test",
    "applicant.phone": "312-555-0126", "address.line1": "311 Willow Court", "address.city": "Chicago",
    "address.state": "Illinois", "address.postalCode": "60612", "address.country": "United States",
    "household.count": "3", "tax.dependents": "Yes",
  },
  "Recent graduate": {
    "applicant.firstName": "Noah", "applicant.lastName": "Williams", "applicant.email": "noah.williams@example.test",
    "applicant.phone": "646-555-0181", "address.line1": "48 College Walk", "address.city": "Albany",
    "address.state": "New York", "address.postalCode": "12207", "address.country": "United States",
    "education.school": "Example State University", "education.degree": "Bachelor's",
  },
  "Homeowner filing a property claim": {
    "applicant.firstName": "Elena", "applicant.lastName": "Martin", "applicant.email": "elena.martin@example.test",
    "applicant.phone": "407-555-0164", "address.line1": "630 Palm Grove Road", "address.city": "Orlando",
    "address.state": "Florida", "address.postalCode": "32803", "address.country": "United States",
    "policy.syntheticNumber": "TEST-HOME-4021",
  },
  "Driver filing an auto claim": {
    "applicant.firstName": "Darius", "applicant.lastName": "King", "applicant.email": "darius.king@example.test",
    "applicant.phone": "213-555-0135", "address.line1": "220 Sunset Terrace", "address.city": "Los Angeles",
    "address.state": "California", "address.postalCode": "90012", "address.country": "United States",
    "policy.syntheticNumber": "TEST-AUTO-7318",
  },
} as const;

export const categoryLabels: Record<Category, string> = {
  jobs: "Job applications",
  tax: "Tax preparation",
  insurance: "Insurance claims",
  benefits: "Government benefits",
};
