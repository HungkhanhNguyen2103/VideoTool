declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string;
  }

  function pdfParse(buffer: Buffer): Promise<PdfParseResult>;
  export = pdfParse;
}

declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string;
  }

  function pdfParse(buffer: Buffer): Promise<PdfParseResult>;
  export = pdfParse;
}
