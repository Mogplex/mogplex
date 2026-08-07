export type ActiveRepoProps = {
  id: string;
  full_name: string;
  root_directory?: string | null;
  default_branch?: string;
  working_branch: string | null;
};

export type ActiveSandboxProps = {
  id: string;
};
