import React, { useState } from "react";
import TemplatePicker from "../../../../components/TemplatePicker";

export default function Step2Template() {
  const [templateCode, setTemplateCode] = useState();

  return (
    <TemplatePicker
      kind="quote"
      selected={templateCode}
      onSelect={setTemplateCode}
    />
  );
}