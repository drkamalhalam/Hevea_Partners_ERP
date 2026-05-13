import { createContext, useContext, useState, ReactNode } from "react";

interface ProjectFilterContextValue {
  selectedProjectId: number | null;
  setSelectedProjectId: (id: number | null) => void;
}

const ProjectFilterContext = createContext<ProjectFilterContextValue>({
  selectedProjectId: null,
  setSelectedProjectId: () => {},
});

export function ProjectFilterProvider({ children }: { children: ReactNode }) {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  return (
    <ProjectFilterContext.Provider value={{ selectedProjectId, setSelectedProjectId }}>
      {children}
    </ProjectFilterContext.Provider>
  );
}

export function useProjectFilter() {
  return useContext(ProjectFilterContext);
}
