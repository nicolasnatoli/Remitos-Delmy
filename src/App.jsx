import React, { useState } from 'react';
import Layout from './components/shared/Layout';
import ModuloA from './components/ModuloA/ModuloA';
import ModuloB from './components/ModuloB/ModuloB';

export default function App() {
  const [activeModule, setActiveModule] = useState('B');

  return (
    <Layout activeModule={activeModule} setActiveModule={setActiveModule}>
      {activeModule === 'A' && <ModuloA />}
      {activeModule === 'B' && <ModuloB />}
    </Layout>
  );
}
