/**
 * UI mirror of ROLE_SECTIONS from src/role-taxonomy.js (the bot-side source
 * of truth). Duplicated because the Next app doesn't import outside web/;
 * tests/role-taxonomy.test.js in the bot's suite asserts the two files stay
 * identical, so drift fails CI-on-EC2 rather than silently splitting the UI
 * from the classifier.
 */

export const ROLE_SECTIONS = {
  software_engineering: {
    label: "Software Engineering",
    categories: [
      { value: "software_engineer", label: "Software Engineer" },
      { value: "frontend", label: "Frontend" },
      { value: "backend", label: "Backend" },
      { value: "mobile", label: "Mobile" },
      { value: "devops_sre", label: "DevOps / SRE" },
      { value: "security", label: "Security" },
      { value: "qa_sdet", label: "QA / SDET" },
      { value: "embedded", label: "Embedded / Firmware" },
      { value: "solutions", label: "Solutions Architect / Engineer" },
    ],
  },
  data_ai: {
    label: "Data Science & AI",
    categories: [
      { value: "data_scientist", label: "Data Scientist" },
      { value: "data_analyst", label: "Data Analyst" },
      { value: "data_engineer", label: "Data Engineer / Modeling" },
      { value: "ml_engineer", label: "ML / AI Engineer" },
      { value: "research_engineer", label: "Research Engineer" },
    ],
  },
  management: {
    label: "Management",
    categories: [
      { value: "product_manager", label: "Product Manager" },
      { value: "program_manager", label: "Program Manager / TPM" },
      { value: "engineering_manager", label: "Engineering Manager" },
      { value: "project_manager", label: "Project Manager / Scrum" },
    ],
  },
  finance: {
    label: "Finance",
    categories: [
      { value: "quant", label: "Quantitative Research / Dev" },
      { value: "financial_analyst", label: "Financial Analyst / IB" },
      { value: "risk", label: "Risk" },
      { value: "fpa_accounting", label: "Accounting / FP&A / Audit" },
    ],
  },
};
