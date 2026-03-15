import { useState, useEffect } from 'react';

export interface Company {
  id: string;
  name: string;
  info: string;
  logoBase64: string | null;
}

export function useCompanies() {
  const [companies, setCompanies] = useState<Company[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem('insta_companies');
    if (stored) {
      try {
        setCompanies(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse companies from local storage", e);
      }
    }
  }, []);

  const addCompany = (company: Omit<Company, 'id'>) => {
    const newCompany = { ...company, id: crypto.randomUUID() };
    const updated = [...companies, newCompany];
    setCompanies(updated);
    localStorage.setItem('insta_companies', JSON.stringify(updated));
    return newCompany;
  };

  const deleteCompany = (id: string) => {
    const updated = companies.filter(c => c.id !== id);
    setCompanies(updated);
    localStorage.setItem('insta_companies', JSON.stringify(updated));
  };

  return { companies, addCompany, deleteCompany };
}
