import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as ejs from 'ejs';
import * as puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import { join } from 'path';
import { promises as fs } from 'fs';
import { PDFOptions } from 'puppeteer';

@Injectable()
export class PdfService {
  private readonly assetsPath = join(__dirname, '..', '..', '..', 'assets');

  async generatePdf(data: any, templateName: string): Promise<Buffer> {
    try {
      // Vérification et préparation des données
      const preparedData = this.preparePdfData(data);

      // Génération du HTML
      const html = await this.renderTemplate(templateName, preparedData);

      // Génération du PDF
      return await this.generatePdfFromHtml(html);
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to generate PDF: ${error.message}`,
      );
    }
  }

  private async renderTemplate(templateName: string, data: any): Promise<string> {
    const templatePath = join(
      this.assetsPath,
      'templates',
      `${templateName}.ejs`,
    );

    try {
      const template = await fs.readFile(templatePath, 'utf8');
      const imageBase64 = await this.imageToBase64(
        join(this.assetsPath, 'images', 'logo.png'),
      );

      return ejs.render(template, { 
        ...data, 
        logo: imageBase64,
        formatNumber: (value: any) => this.formatNumber(value),
      });
    } catch (error) {
      throw new Error(`Template rendering failed: ${error.message}`);
    }
  }

  private async generatePdfFromHtml(html: string): Promise<Buffer> {
    let browser;
    try {
      browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });

      // Ajout des stylesheets
      const stylesheets = await this.getStylesheets(html);
      for (const stylesheet of stylesheets) {
        await page.addStyleTag({
          path: join(this.assetsPath, 'css', stylesheet),
        });
      }

      const pdfOptions: PDFOptions = {
        format: 'A4',
        margin: {
          top: '20mm',
          right: '10mm',
          bottom: '20mm',
          left: '10mm',
        },
        printBackground: true,
      };

      return await page.pdf(pdfOptions);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  private preparePdfData(data: any): any {
    // Conversion sécurisée des nombres
    if (data.article) {
      return {
        ...data,
        article: {
          ...data.article,
          unitPrice: this.safeNumber(data.article.unitPrice),
          quantityInStock: this.safeNumber(data.article.quantityInStock),
          version: this.safeNumber(data.article.version),
        },
      };
    }
    return data;
  }

  private safeNumber(value: any): number {
    if (typeof value === 'number') return value;
    const num = Number(value);
    return isNaN(num) ? 0 : num;
  }

  private formatNumber(value: any): string {
    const num = this.safeNumber(value);
    return num.toFixed(2);
  }

  private async getStylesheets(html: string): Promise<string[]> {
    try {
      const $ = cheerio.load(html);
      const stylesheets: string[] = [];

      $('link[rel="stylesheet"]').each((i, elem) => {
        const href = $(elem).attr('href');
        if (href && !/^(http|https|ftp|www|\/\/)/.test(href)) {
          stylesheets.push(href);
        }
      });

      return stylesheets;
    } catch (error) {
      console.warn('Failed to parse stylesheets:', error);
      return [];
    }
  }

  private async imageToBase64(imagePath: string): Promise<string> {
    try {
      const imageBuffer = await fs.readFile(imagePath);
      const extension = imagePath.split('.').pop()?.toLowerCase() || 'png';
      return `data:image/${extension};base64,${imageBuffer.toString('base64')}`;
    } catch (error) {
      console.error('Failed to convert image to base64:', error);
      return '';
    }
  }

  async generateFromHtml(
    html: string,
    options?: {
      format?: PDFOptions['format'];
      margin?: PDFOptions['margin'];
      printBackground?: boolean;
    },
  ): Promise<Buffer> {
    let browser;
    try {
      browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const pdfOptions: PDFOptions = {
        format: options?.format || 'A4',
        margin: options?.margin || {
          top: '20mm',
          right: '10mm',
          bottom: '20mm',
          left: '10mm',
        },
        printBackground: options?.printBackground !== false,
      };

      return await page.pdf(pdfOptions);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}