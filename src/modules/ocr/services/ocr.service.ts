import { Injectable } from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class OcrService {
  async extractTextFromImage(imagePath: string): Promise<string> {
    // Créer un worker Tesseract
    const worker = await createWorker();

    try {
      // Charger le worker
      await worker.load();

      // Charger la langue française
    //  await worker.loadLanguage('fra');

      // Initialiser Tesseract avec la langue française
    //  await worker.initialize('fra');

      // Extraire le texte de l'image
      const { data: { text } } = await worker.recognize(imagePath);

      // Retourner le texte extrait
      return text;
    } catch (error) {
      console.error('Erreur lors de l\'extraction du texte :', error);
      throw new Error('Erreur lors de l\'extraction du texte');
    } finally {
      // Terminer le worker
      await worker.terminate();
    }
  }

  async parseInvoice(text: string): Promise<any> {
    const invoiceData = {
      invoiceNumber: null,
      date: null,
      totalAmount: null,
      supplierName: null,
      supplierAddress: null,
      items: [],
    };

    // Exemple de regex pour extraire le numéro de facture
    const invoiceNumberMatch = text.match(/Facture\s*N°\s*(\d+)/);
    if (invoiceNumberMatch) {
      invoiceData.invoiceNumber = invoiceNumberMatch[1];
    }

    // Exemple de regex pour extraire la date
    const dateMatch = text.match(/Date\s*:\s*(\d{2}\/\d{2}\/\d{4})/);
    if (dateMatch) {
      invoiceData.date = dateMatch[1];
    }

    // Exemple de regex pour extraire le montant total
    const totalMatch = text.match(/Total\s*:\s*([\d,]+\.\d{2})\s*€/);
    if (totalMatch) {
      invoiceData.totalAmount = parseFloat(totalMatch[1].replace(",", "."));
    }

    // Exemple de regex pour extraire le nom du fournisseur
    const supplierNameMatch = text.match(/Fournisseur\s*:\s*(.+)/);
    if (supplierNameMatch) {
      invoiceData.supplierName = supplierNameMatch[1];
    }

    // Exemple de regex pour extraire l'adresse du fournisseur
    const supplierAddressMatch = text.match(/Adresse\s*:\s*(.+)/);
    if (supplierAddressMatch) {
      invoiceData.supplierAddress = supplierAddressMatch[1];
    }

    // Exemple de regex pour extraire les articles
    const itemsMatches = text.matchAll(/(\d+)\s+(.+?)\s+(\d+\.\d{2})\s+(\d+\.\d{2})/g);
    for (const match of itemsMatches) {
      invoiceData.items.push({
        quantity: parseInt(match[1]),
        description: match[2],
        unitPrice: parseFloat(match[3]),
        totalPrice: parseFloat(match[4]),
      });
    }

    return invoiceData;
  }
}