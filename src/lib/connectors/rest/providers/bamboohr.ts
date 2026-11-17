import type { RestConnectorSpec } from "../spec";

/**
 * https://documentation.bamboohr.com/docs/getting-started -- HTTP basic auth with the API key as the username and any
 * string (here `x`) as the password, against the company's own `{companyDomain}.bamboohr.com/api/v1`.
 */
export const bamboohr: RestConnectorSpec = {
  id: "bamboohr",
  name: "BambooHR",
  description: "Read the employee directory, one employee's job details, and who is out.",
  category: "HR & recruiting",
  docsUrl: "https://documentation.bamboohr.com/docs/getting-started",
  host: "{config.company}.bamboohr.com",
  basePath: "/api/v1",
  credential: {
    label: "API key",
    help: "In BambooHR, click your profile photo → API Keys → Add New Key. The key acts with your own BambooHR permissions.",
  },
  configFields: [
    {
      key: "company",
      label: "Company domain",
      placeholder: "acme (for acme.bamboohr.com)",
      pattern: "^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$",
    },
  ],
  auth: { basic: { username: "{key}", password: "x" } },
  verify: { method: "GET", path: "/meta/fields" },
  operations: [
    {
      slug: "get_directory",
      summary: "Returns the company's published employee directory.",
      method: "GET",
      path: "/employees/directory",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [],
    },
    {
      slug: "get_employee",
      summary: "Returns one employee's name, job title, department, location, work email and status.",
      method: "GET",
      path: "/employees/{employee_id}",
      sideEffect: "read",
      resourceType: "employee",
      resource: "employee_id",
      dataSensitivity: "confidential",
      args: [{ key: "employee_id", in: "path", required: true, description: "The BambooHR employee id." }],
      fixedQuery: { fields: "firstName,lastName,jobTitle,department,location,workEmail,supervisor,status" },
    },
    {
      slug: "whos_out",
      summary: "Lists employees who are out, and company holidays, in a date range (default: next 14 days).",
      method: "GET",
      path: "/time_off/whos_out",
      sideEffect: "read",
      resourceType: "account",
      dataSensitivity: "confidential",
      args: [
        { key: "start", in: "query", required: false, description: "First day, YYYY-MM-DD." },
        { key: "end", in: "query", required: false, description: "Last day, YYYY-MM-DD." },
      ],
    },
  ],
};
