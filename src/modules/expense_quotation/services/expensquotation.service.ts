/* eslint-disable prettier/prettier */
import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { ExpensQuotationEntity } from '../repositories/entities/expensquotation.entity';
import { QuotationNotFoundException } from '../errors/quotation.notfound.error';
import { ResponseExpensQuotationDto } from '../dtos/expensquotation.response.dto';
import { PageDto } from 'src/common/database/dtos/database.page.dto';
import { PageMetaDto } from 'src/common/database/dtos/database.page-meta.dto';
import { CreateExpensQuotationDto } from '../dtos/expensquotation.create.dto';
import { UpdateExpensQuotationDto } from '../dtos/expensquotation.update.dto';
import { CurrencyService } from 'src/modules/currency/services/currency.service';
import { FirmService } from 'src/modules/firm/services/firm.service';
import { InterlocutorService } from 'src/modules/interlocutor/services/interlocutor.service';
import { InvoicingCalculationsService } from 'src/common/calculations/services/invoicing.calculations.service';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { FindManyOptions, FindOneOptions } from 'typeorm';
import { ArticleExpensQuotationEntryService } from './article-expensquotation-entry.service';
import { ArticleExpensQuotationEntryEntity } from '../repositories/entities/article-expensquotation-entry.entity';
import { PdfService } from 'src/common/pdf/services/pdf.service';
import { format, isAfter } from 'date-fns';
import { QueryBuilder } from 'src/common/database/utils/database-query-builder';
import { ExpensQuotationMetaDataService } from './expensquotation-meta-data.service';
import { TaxService } from 'src/modules/tax/services/tax.service';
import { BankAccountService } from 'src/modules/bank-account/services/bank-account.service';
import { ExpensQuotationUploadService } from './expensquotation-upload.service';
import { ExpensequotationRepository } from '../repositories/repository/expensquotation.repository';
import { EXPENSQUOTATION_STATUS } from '../enums/expensquotation-status.enum';
import { Transactional } from '@nestjs-cls/transactional';
import { DuplicateExpensQuotationDto } from '../dtos/expensquotation.duplicate.dto';
import { ExpensQuotationMetaDataEntity } from '../repositories/entities/expensquotation-meta-data.entity';
import { StorageBadRequestException } from 'src/common/storage/errors/storage.bad-request.error';
import { StorageService } from 'src/common/storage/services/storage.service';
import { ExpensQuotationUploadEntity } from '../repositories/entities/expensquotation-file.entity';


@Injectable()
export class ExpensQuotationService {
  constructor(
    //repositories
    private readonly expensequotationRepository: ExpensequotationRepository,
    //entity services
    private readonly expensearticleQuotationEntryService: ArticleExpensQuotationEntryService,
    private readonly expensequotationUploadService: ExpensQuotationUploadService,
    private readonly bankAccountService: BankAccountService,
    private readonly currencyService: CurrencyService,
    private readonly firmService: FirmService,
    private readonly interlocutorService: InterlocutorService,
    private readonly expensequotationMetaDataService: ExpensQuotationMetaDataService,
    private readonly taxService: TaxService,
    private readonly storageService: StorageService,
    

    //abstract services
    private readonly calculationsService: InvoicingCalculationsService,
    private readonly pdfService: PdfService,
  ) {}


  

  async findOneByCondition(
    query: IQueryObject,
  ): Promise<ExpensQuotationEntity | null> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    
    // Ajoutez ceci pour forcer les relations
    queryOptions.relations = [
      ...(queryOptions.relations || []),
      'expensearticleQuotationEntries',
      'expensearticleQuotationEntries.article',
      'expensearticleQuotationEntries.articleExpensQuotationEntryTaxes',
      'expensearticleQuotationEntries.articleExpensQuotationEntryTaxes.tax'
    ];
  
    const quotation = await this.expensequotationRepository.findOne(
      queryOptions as FindOneOptions<ExpensQuotationEntity>,
    );
    
    if (!quotation) return null;
    
    // Solution de secours si les articles ne sont pas chargés
    if (!quotation.expensearticleQuotationEntries) {
    }
    
    return quotation;
  }

  async findAll(query: IQueryObject = {}): Promise<ExpensQuotationEntity[]> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    
    return await this.expensequotationRepository.findAll(
      queryOptions as FindManyOptions<ExpensQuotationEntity>,
    );
  }

  async findAllPaginated(
    query: IQueryObject,
  ): Promise<PageDto<ResponseExpensQuotationDto>> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const count = await this.expensequotationRepository.getTotalCount({
      where: queryOptions.where,
    });

    const entities = await this.expensequotationRepository.findAll(
      queryOptions as FindManyOptions<ExpensQuotationEntity>,
    );

    const pageMetaDto = new PageMetaDto({
      pageOptionsDto: {
        page: parseInt(query.page),
        take: parseInt(query.limit),
      },
      itemCount: count,
    });

    return new PageDto(entities, pageMetaDto);
  }

  
  @Transactional()
  async save(createQuotationDto: CreateExpensQuotationDto): Promise<ExpensQuotationEntity> {
    try {
      console.log('Received DTO:', createQuotationDto);
  
      // 1. Vérification initiale du numéro séquentiel
      if (!createQuotationDto.sequentialNumbr) {
        throw new Error('Quotation number is required');
      }
  
      if (!/^QUO-\d+$/.test(createQuotationDto.sequentialNumbr)) {
        throw new Error('Invalid quotation number format. Expected format: QUO-XXXX');
      }
  
      // Vérification de l'unicité du numéro séquentiel
      const existingQuotation = await this.expensequotationRepository.findOne({
        where: { sequential: createQuotationDto.sequentialNumbr }
      });
  
      if (existingQuotation) {
        throw new HttpException(
          'Ce numéro de devis existe déjà', // Message simple en français
          HttpStatus.CONFLICT
        );
      }
  
      // Récupérer les entités associées
      const [firm, bankAccount, currency] = await Promise.all([
        this.firmService.findOneByCondition({
          filter: `id||$eq||${createQuotationDto.firmId}`,
        }),
        createQuotationDto.bankAccountId
          ? this.bankAccountService.findOneById(createQuotationDto.bankAccountId)
          : Promise.resolve(null),
        createQuotationDto.currencyId
          ? this.currencyService.findOneById(createQuotationDto.currencyId)
          : Promise.resolve(null),
      ]);
  
      if (!firm) {
        throw new Error('Firm not found');
      }
  
      await this.interlocutorService.findOneById(createQuotationDto.interlocutorId);
      console.log('Articles received:', createQuotationDto.articleQuotationEntries);
  
      // Valider les articles
      // Valider les articles
if (!createQuotationDto.articleQuotationEntries?.length) {
  throw new Error('No article entries provided');
}

for (const [index, entry] of createQuotationDto.articleQuotationEntries.entries()) {
  if (!entry.article?.title) {
    throw new Error(`Invalid article entry at index ${index}: Title is required`);
  }
  
  if (entry.quantity === undefined || entry.unit_price === undefined) {
    throw new Error(`Invalid article entry at index ${index}: Quantity and unit price are required`);
  }

  // Validation supplémentaire pour les articles existants
 
}
  
      for (const [index, entry] of createQuotationDto.articleQuotationEntries.entries()) {
        if (!entry.article?.title || entry.quantity === undefined || entry.unit_price === undefined) {
          const missingFields = [];
          if (!entry.article?.title) missingFields.push('title');
          if (entry.quantity === undefined) missingFields.push('quantity');
          if (entry.unit_price === undefined) missingFields.push('unit_price');
          throw new Error(`Invalid article entry at index ${index}: Missing required fields (${missingFields.join(', ')}).`);
        }
  
        if (typeof entry.unit_price !== 'number' || typeof entry.quantity !== 'number') {
          throw new Error(`Invalid type for unit_price or quantity at index ${index}`);
        }
      }
  
      // Sauvegarder les articles
      const articleEntries = await this.expensearticleQuotationEntryService.saveMany(createQuotationDto.articleQuotationEntries);
      console.log('Saved article entries:', articleEntries);
  
      if (!articleEntries?.length) {
        throw new Error('Article entries could not be saved');
      }
  
      // Calculer les totaux
      const { subTotal, total } = this.calculationsService.calculateLineItemsTotal(
        articleEntries.map(entry => entry.total),
        articleEntries.map(entry => entry.subTotal),
      );
  
      const totalAfterGeneralDiscount = this.calculationsService.calculateTotalDiscount(
        total,
        createQuotationDto.discount,
        createQuotationDto.discount_type,
      );
  
      // Récupérer les line items
      const lineItems = await this.expensearticleQuotationEntryService.findManyAsLineItem(
        articleEntries.map(entry => entry.id),
      );
  
      // Calculer le résumé des taxes
      const taxSummary = await Promise.all(
        this.calculationsService.calculateTaxSummary(lineItems).map(async item => {
          const tax = await this.taxService.findOneById(item.taxId);
          return {
            ...item,
            label: tax.label,
            value: tax.isRate ? tax.value * 100 : tax.value,
            isRate: tax.isRate,
          };
        }),
      );
  
      // Récupérer le fichier PDF
      let uploadPdfField = null;
      if (createQuotationDto.pdfFileId) {
        uploadPdfField = await this.storageService.findOneById(createQuotationDto.pdfFileId);
        if (!uploadPdfField) {
          throw new NotFoundException('Uploaded PDF file not found');
        }
      }
  
      // Sauvegarder les métadonnées
      const expensequotationMetaData = await this.expensequotationMetaDataService.save({
        ...createQuotationDto.expensequotationMetaData,
        taxSummary,
      });
  
      console.log('Quotation metadata saved:', expensequotationMetaData);
  
      // Sauvegarder la quotation
      const quotation = await this.expensequotationRepository.save({
        ...createQuotationDto,
        sequential: createQuotationDto.sequentialNumbr, // Utilisation directe de la valeur fournie
        bankAccountId: bankAccount?.id ?? null,
        currencyId: currency?.id ?? firm.currencyId,
        expensearticleQuotationEntries: articleEntries,
        expensequotationMetaData,
        subTotal,
        total: totalAfterGeneralDiscount,
        uploadPdfField: uploadPdfField ? uploadPdfField.id : null,
        pdfFileId: uploadPdfField ? uploadPdfField.id : null,
      });
  
      console.log('Final saved quotation:', quotation);
  
      // Gérer les uploads
      if (createQuotationDto.uploads?.length) {
        await this.expensequotationUploadService.saveMany(
          quotation.id,
          createQuotationDto.uploads.map(upload => upload.uploadId)
        );
      }
  
      return quotation;
    } catch (error) {
      console.error('Error saving quotation:', error);
      throw new Error(`Failed to save quotation: ${error.message}`);
    }
  }

  
  async findOneById(id: number): Promise<ExpensQuotationEntity> {
    const expensequotation = await this.expensequotationRepository.findOne({
      where: { id },
      withDeleted: true, // Permet de retrouver les éléments soft-deleted
    });
  
    if (!expensequotation) {
      throw new QuotationNotFoundException();
    }
    
    return expensequotation;
  }

  async saveMany(
    createQuotationDtos: CreateExpensQuotationDto[],
  ): Promise<ExpensQuotationEntity[]> {
    const quotations = [];
    for (const createQuotationDto of createQuotationDtos) {
      const quotation = await this.save(createQuotationDto);
      quotations.push(quotation);
    }
    return quotations;
  }


  async softDelete(id: number): Promise<ExpensQuotationEntity> {
    await this.findOneById(id);
    return this.expensequotationRepository.softDelete(id);
  }

  async deleteAll() {
    return this.expensequotationRepository.deleteAll();
  }

  async updateQuotationUploads(
    id: number,
    updateQuotationDto: UpdateExpensQuotationDto,
    existingUploads: UpdateExpensQuotationDto[],
  ) {
    const newUploads = [];
    const keptUploads = [];
    const eliminatedUploads = [];

    if (updateQuotationDto.uploads) {
      for (const upload of existingUploads) {
        const exists = updateQuotationDto.uploads.some(
          (u) => u.id === upload.id,
        );
        if (!exists)
          eliminatedUploads.push(
            await this.expensequotationUploadService.softDelete(upload.id),
          );
        else keptUploads.push(upload);
      }
      for (const upload of updateQuotationDto.uploads) {
        if (!upload.id)
          newUploads.push(
            await this.expensequotationUploadService.save(id, upload.uploadId),
          );
      }
    }
    return {
      keptUploads,
      newUploads,
      eliminatedUploads,
    };
  }

  async updateStatus(
    id: number,
    status: EXPENSQUOTATION_STATUS,
  ): Promise<ExpensQuotationEntity> {
    const quotation = await this.expensequotationRepository.findOneById(id);
    return this.expensequotationRepository.save({
      id: quotation.id,
      status,
    });
  }


  @Transactional()
async update(
  id: number,
  updateQuotationDto: UpdateExpensQuotationDto,
): Promise<ExpensQuotationEntity> {
  // Récupérer l'ancienne quotation avec ses relations
  const existingQuotation = await this.findOneByCondition({
    filter: `id||$eq||${id}`,
    join: 'expensearticleQuotationEntries,expensequotationMetaData,uploads,uploadPdfField',
  });

  if (!existingQuotation) {
    throw new Error("Quotation not found");
  }

  // Récupérer et valider les entités associées en parallèle
  const [firm, bankAccount, currency, interlocutor] = await Promise.all([
    this.firmService.findOneByCondition({
      filter: `id||$eq||${updateQuotationDto.firmId}`,
    }),
    updateQuotationDto.bankAccountId
      ? this.bankAccountService.findOneById(updateQuotationDto.bankAccountId)
      : null,
    updateQuotationDto.currencyId
      ? this.currencyService.findOneById(updateQuotationDto.currencyId)
      : null,
    updateQuotationDto.interlocutorId
      ? this.interlocutorService.findOneById(updateQuotationDto.interlocutorId)
      : null,
  ]);

  // Supprimer logiquement les anciennes entrées d'article
  const existingArticles =
    await this.expensearticleQuotationEntryService.softDeleteMany(
      existingQuotation.expensearticleQuotationEntries.map((entry) => entry.id),
    );

  // Sauvegarder les nouvelles entrées d'article
  const articleEntries = updateQuotationDto.articleQuotationEntries
    ? await this.expensearticleQuotationEntryService.saveMany(
        updateQuotationDto.articleQuotationEntries,
      )
    : existingArticles;

  // Calculer le sous-total et le total des nouvelles entrées
  const { subTotal, total } =
    this.calculationsService.calculateLineItemsTotal(
      articleEntries.map((entry) => entry.total),
      articleEntries.map((entry) => entry.subTotal),
    );

  // Appliquer la remise générale
  const totalAfterGeneralDiscount =
    this.calculationsService.calculateTotalDiscount(
      total,
      updateQuotationDto.discount,
      updateQuotationDto.discount_type,
    );

  // Convertir les entrées d'article en éléments de ligne
  const lineItems =
    await this.expensearticleQuotationEntryService.findManyAsLineItem(
      articleEntries.map((entry) => entry.id),
    );

  // Calculer le résumé des taxes
  const taxSummary = await Promise.all(
    this.calculationsService
      .calculateTaxSummary(lineItems)
      .map(async (item) => {
        const tax = await this.taxService.findOneById(item.taxId);
        return {
          ...item,
          label: tax.label,
          rate: tax.isRate ? tax.value * 100 : tax.value,
          isRate: tax.isRate,
        };
      }),
  );

  // Sauvegarder ou mettre à jour les métadonnées de la quotation
  const expensequotationMetaData = await this.expensequotationMetaDataService.save({
    ...existingQuotation.expensequotationMetaData,
    ...updateQuotationDto.expensequotationMetaData,
    taxSummary,
  });

  // Récupérer ou conserver le numéro séquentiel
  const sequentialNumbr = updateQuotationDto.sequentialNumbr || existingQuotation.sequential;

  // Vérifier le format du numéro séquentiel
  if (sequentialNumbr && !/^QUO-\d+$/.test(sequentialNumbr)) {
    throw new Error('Invalid quotation number format. Expected format: QUO-XXXX');
  }

  // ✅ Gestion du fichier PDF
  let pdfFileId = existingQuotation.pdfFileId; // Conserver l'ID existant par défaut

  // Seulement mettre à jour si un nouveau PDF est explicitement fourni
  if (updateQuotationDto.pdfFileId && updateQuotationDto.pdfFileId !== existingQuotation.pdfFileId) {
    // Supprimer l'ancien fichier si il existe et est différent du nouveau
    if (existingQuotation.pdfFileId) {
      await this.storageService.delete(existingQuotation.pdfFileId);
    }
    pdfFileId = updateQuotationDto.pdfFileId;
  }

  // Gestion des fichiers uploadés - NOUVELLE APPROCHE
  let uploads: ExpensQuotationUploadEntity[] = [...existingQuotation.uploads || []];
  
  if (updateQuotationDto.uploads) {
    // 1. Extraire les uploadIds de la requête
    const requestedUploadIds = updateQuotationDto.uploads.map(u => u.uploadId);
    
    // 2. Identifier les uploads existants à conserver
    uploads = uploads.filter(upload => requestedUploadIds.includes(upload.uploadId));
    
    // 3. Identifier les nouveaux uploads à ajouter
    const existingUploadIds = uploads.map(u => u.uploadId);
    const uploadsToAdd = updateQuotationDto.uploads
      .filter(u => !existingUploadIds.includes(u.uploadId))
      .map(u => ({ 
        expensequotationId: id, 
        uploadId: u.uploadId 
      }));
    
    // 4. Ajouter les nouveaux uploads
    // Correction dans la fonction update
if (uploadsToAdd.length > 0) {
  const uploadIdsToAdd = uploadsToAdd.map(u => u.uploadId);
  await this.expensequotationUploadService.saveMany(id, uploadIdsToAdd);
  
  // Récupérer les nouveaux uploads créés
  const newUploads = await this.expensequotationUploadService.findByUploadIds(uploadIdsToAdd);
  uploads.push(...newUploads);
}
  }

  // Sauvegarder et retourner la quotation mise à jour
  const updatedQuotation = await this.expensequotationRepository.save({
    ...existingQuotation,
    ...updateQuotationDto,
    sequential: sequentialNumbr,
    bankAccountId: bankAccount ? bankAccount.id : null,
    currencyId: currency ? currency.id : firm.currencyId,
    interlocutorId: interlocutor ? interlocutor.id : null,
    expensearticleQuotationEntries: articleEntries,
    expensequotationMetaData,
    subTotal,
    total: totalAfterGeneralDiscount,
    pdfFileId,
    uploads, // Liste mise à jour des uploads
  });

  return updatedQuotation;
}

async updateExpenseQuotationUpload(
  id: number,
  updateQuotationDto: UpdateExpensQuotationDto,
  existingUploads: ExpensQuotationUploadEntity[],
) {
  const newUploads: ExpensQuotationUploadEntity[] = [];
  const keptUploads: ExpensQuotationUploadEntity[] = [];
  const eliminatedUploads: ExpensQuotationUploadEntity[] = [];

  if (updateQuotationDto.uploads) {
    try {
      // 1. Identifier les fichiers à supprimer
      for (const existingUpload of existingUploads) {
        const shouldKeep = updateQuotationDto.uploads.some(
          u => u.uploadId === existingUpload.uploadId
        );
        
        if (!shouldKeep) {
          console.log(`Suppression du fichier avec ID: ${existingUpload.id}`);
          const deletedUpload = await this.expensequotationUploadService.softDelete(existingUpload.id);
          eliminatedUploads.push(deletedUpload);
        } else {
          keptUploads.push(existingUpload);
        }
      }

      // 2. Identifier les nouveaux fichiers à ajouter
      for (const newUploadDto of updateQuotationDto.uploads) {
        const alreadyExists = existingUploads.some(
          eu => eu.uploadId === newUploadDto.uploadId
        );
        
        if (!alreadyExists) {
          console.log(`Ajout d'un nouveau fichier avec uploadId: ${newUploadDto.uploadId} pour la quotation ${id}`);
          const newUpload = await this.expensequotationUploadService.create({
            expensequotationId: id, // Ici on s'assure que l'ID est bien passé
            uploadId: newUploadDto.uploadId
          });
          
          // Vérification que l'ID a bien été enregistré
          if (!newUpload.expensequotationId) {
            throw new Error(`Failed to associate upload ${newUploadDto.uploadId} with quotation ${id}`);
          }
          
          newUploads.push(newUpload);
        }
      }
    } catch (error) {
      console.error('Erreur lors de la gestion des fichiers:', error);
      throw new Error('Failed to update quotation uploads');
    }
  }

  return { keptUploads, newUploads, eliminatedUploads };
}

async duplicate(
  duplicateQuotationDto: DuplicateExpensQuotationDto,
): Promise<ResponseExpensQuotationDto> {
  try {
    // 1. Récupération stricte du devis original
    const original = await this.expensequotationRepository.findOne({
      where: { id: duplicateQuotationDto.id },
      relations: [
        'expensequotationMetaData',
        'expensearticleQuotationEntries',
        'uploads',
        'uploadPdfField'
      ],
    });

    if (!original) throw new Error("Original quotation not found");

    console.log(`[DUPLICATION] IncludeFiles: ${duplicateQuotationDto.includeFiles}, Original PDF: ${original.uploadPdfField?.id || 'none'}`);

    // 2. Nettoyage COMPLET des références fichiers
    const baseData = {
      ...original,
      id: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      sequential: null,
      sequentialNumbr: null,
      status: EXPENSQUOTATION_STATUS.Draft,
      // Métadonnées toujours dupliquées
      expensequotationMetaData: await this.expensequotationMetaDataService.duplicate(
        original.expensequotationMetaData.id
      ),
      // Articles toujours dupliqués
      expensearticleQuotationEntries: [],
      // Fichiers TOUJOURS initialisés à vide/null
      uploads: [], // <-- Important
      uploadPdfField: null, // <-- Critique
      pdfFileId: null // <-- Essentiel
    };

    // 3. Création du nouveau devis (sans fichiers)
    const newQuotation = await this.expensequotationRepository.save(baseData);

    // 4. Duplication conditionnelle STRICTE
    let finalUploads = [];
    let finalPdf = null;

    if (duplicateQuotationDto.includeFiles) {
      console.log("[DUPLICATION] Processing files...");
      
      // a. Uploads réguliers
      if (original.uploads?.length > 0) {
        finalUploads = await this.expensequotationUploadService.duplicateMany(
          original.uploads.map(u => u.id),
          newQuotation.id
        );
      }

      // b. PDF - UNIQUEMENT si includeFiles=true ET PDF existant
      if (original.uploadPdfField) {
        console.log(`[DUPLICATION] Attempting PDF duplication from ${original.uploadPdfField.id}`);
        finalPdf = await this.storageService.duplicate(original.uploadPdfField.id);
      }
    }

    // 5. Mise à jour FINALE avec vérification
    const result = await this.expensequotationRepository.save({
      ...newQuotation,
      expensearticleQuotationEntries: await this.expensearticleQuotationEntryService.duplicateMany(
        original.expensearticleQuotationEntries.map(e => e.id),
        newQuotation.id
      ),
      uploads: finalUploads,
      uploadPdfField: finalPdf, // Reste null si includeFiles=false
      pdfFileId: finalPdf?.id || null // Garanti null si includeFiles=false
    });

    // Vérification de cohérence
    if (!duplicateQuotationDto.includeFiles && result.pdfFileId) {
      console.error("[ERROR] PDF was duplicated despite includeFiles=false!");
      // Correction automatique si nécessaire
      await this.expensequotationRepository.update(result.id, {
        uploadPdfField: null,
        pdfFileId: null
      });
      result.uploadPdfField = null;
      result.pdfFileId = null;
    }

    console.log("[DUPLICATION] Completed:", {
      newId: result.id,
      hasPdf: !!result.pdfFileId,
      expectedPdf: duplicateQuotationDto.includeFiles
    });

    return result;

  } catch (error) {
    console.error("[DUPLICATION FAILED]", {
      error: error.message,
      dto: duplicateQuotationDto,
      stack: error.stack
    });
    throw error;
  }
}
// Dans votre service backend (expensquotation.service.ts)
async deletePdfFile(quotationId: number): Promise<void> {
  const quotation = await this.expensequotationRepository.findOneById(quotationId);
  if (!quotation) {
    throw new Error("Quotation not found");
  }

  if (quotation.pdfFileId) {
    // Supprimer le fichier PDF de la base de données
    await this.storageService.delete(quotation.pdfFileId);

    // Mettre à jour le devis pour retirer l'ID du fichier PDF
    await this.expensequotationRepository.save({
      ...quotation,
      pdfFileId: null,
      uploadPdfField: null,
    });
  }
}
async updateQuotationStatusIfExpired(quotationId: number): Promise<ExpensQuotationEntity> {
    const quotation = await this.findOneById(quotationId);
    const currentDate = new Date();
    const dueDate = new Date(quotation.dueDate);
  
    if (dueDate < currentDate && quotation.status !== EXPENSQUOTATION_STATUS.Expired) {
      quotation.status = EXPENSQUOTATION_STATUS.Expired;
      return this.expensequotationRepository.save(quotation);
    }
  
    return quotation;
  }



  
  




  
  
}
  
