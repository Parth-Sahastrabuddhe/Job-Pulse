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
  hardware: {
    label: "Hardware Engineering",
    categories: [
      { value: "hardware_asic", label: "Hardware / ASIC / Silicon" },
      { value: "electrical_engineer", label: "Electrical / RF" },
      { value: "mechanical_engineer", label: "Mechanical / Thermal" },
      { value: "manufacturing_industrial", label: "Manufacturing / Industrial" },
    ],
  },
  design: {
    label: "Design",
    categories: [
      { value: "product_design", label: "Product / UX / UI Design" },
      { value: "ux_research", label: "UX Research" },
      { value: "technical_writing", label: "Technical Writing / Docs" },
    ],
  },
  it_operations: {
    label: "IT & Support",
    categories: [
      { value: "it_support", label: "IT Support / Help Desk" },
      { value: "network_sysadmin", label: "Network / SysAdmin" },
      { value: "support_engineer", label: "Support Engineer / TAM" },
    ],
  },
  business_ops: {
    label: "Business Ops & Consulting",
    categories: [
      { value: "operations_bizops", label: "Operations / BizOps" },
      { value: "supply_chain", label: "Supply Chain / Logistics" },
      { value: "consulting_strategy", label: "Consulting / Strategy" },
    ],
  },
  sales_marketing: {
    label: "Sales & Marketing",
    categories: [
      { value: "sales", label: "Sales / Business Development" },
      { value: "marketing", label: "Marketing / Growth" },
      { value: "customer_success", label: "Customer Success" },
    ],
  },
  science_health: {
    label: "Science & Health",
    categories: [
      { value: "biotech_science", label: "Biotech / Clinical / Research" },
    ],
  },
};
