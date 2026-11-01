export type GithubRepoPayload = {
  id: number;
  full_name: string;
  default_branch?: string;
  created_at?: string;
  size?: number;
  owner?: { login?: string };
  name?: string;
};
