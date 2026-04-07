const fs = require("fs");
const path = require("path");
const { Document, Packer, Paragraph, TextRun } = require("docx");

async function generateTemplate() {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: "ESTATE PLANNING DOCUMENT",
                bold: true,
                size: 32,
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: "Client Name: {client_name}",
                size: 24,
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: "Executor: {executor}",
                size: 24,
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: "Trustee Logic: {trustee_logic}",
                size: 24,
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: "This document was generated using docxtemplater and Vertex AI data extraction.",
                italics: true,
                size: 20,
              }),
            ],
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const outPath = path.join(__dirname, "../functions/templates/estate-document.docx");
  fs.writeFileSync(outPath, buffer);
  console.log("Template generated at:", outPath);
}

generateTemplate().catch(console.error);
