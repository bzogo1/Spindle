import { gql } from "./linear-client.mjs"

const TEAM_ID = process.env.LINEAR_TEAM_ID || "3ac43f9f-0db4-48ad-a4a4-6d2a48b8c4e8"

const data = await gql(
  `query($teamId: String!) {
    team(id: $teamId) {
      id name key issueEstimationType issueEstimationAllowZero issueCount
      states { nodes { id name type position } }
      labels { nodes { id name } }
      members { nodes { id name email active } }
    }
    organization { id name labels(first: 100) { nodes { id name } } users(first: 50) { nodes { id name email active } } }
    projects(first: 20) { nodes { id name } }
  }`,
  { teamId: TEAM_ID },
)

console.log(JSON.stringify(data, null, 2))
