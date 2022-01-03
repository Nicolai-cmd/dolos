import assert from "assert";
import { HashFilter } from "../hashing/hashFilter";
import { Options } from "../util/options";
import { Range } from "../util/range";
import { Region } from "../util/region";
import { Tokenizer } from "../tokenizer/tokenizer";
import { WinnowFilter } from "../hashing/winnowFilter";
import { File } from "../file/file";
import { Report, Occurrence } from "./report";
import { TokenizedFile } from "../file/tokenizedFile";

type Hash = number;

export class Index {
  private readonly kgramLength: number;
  private readonly kgramsInWindow: number;
  private readonly index: Map<Hash, Array<Occurrence>> = new Map();
  private readonly tokenizer: Tokenizer;
  private readonly hashFilter: HashFilter;

  /**
   * Creates a Index object with a given Tokenizer , an optional Options
   * object, and an optional HashFilter.
   *
   * If no HashFilter is given, a new WinnowFilter is created with values geven
   * by the Options (or the default Options).
   *
   * After creation, first add files to the index which can then be queried.
   *
   * @param tokenizer A tokenizer for the correct programming language
   * @param options An object with the current options.
   * @param hashFilter An optional HashFilter to hashing the hashes returned by
   * the rolling hashing function.
   */
  constructor(
    tokenizer: Tokenizer,
    private readonly options: Options = new Options(),
    hashFilter?: HashFilter
  ) {
    this.tokenizer = tokenizer;
    this.kgramLength = options.kgramLength;
    this.kgramsInWindow = options.kgramsInWindow;
    this.hashFilter =
      hashFilter
        ? hashFilter
        : new WinnowFilter(this.kgramLength, this.kgramsInWindow, options.kgramData);
  }

  /**
   * Compare a list of files with each other and the files already stored in the
   * index. The compared files are also added to the index.
   *
   * @param files: the file objects which need to be compared to the index
   * and each other. The file hashes will be added to the index.
   * @param hashFilter: an optional HashFilter. By default the HashFilter of the
   * Index object will be used.
   * @return an Report object, which is a list of Pairs
   * (containing all the pairedOccurrences between two files).
   */
  public async compareFiles(
    files: File[],
    hashFilter = this.hashFilter
  ): Promise<Report> {

    const tokenizedFiles = files.map(f => this.tokenizer.tokenizeFile(f));
    return this.compareTokenizedFiles(tokenizedFiles, hashFilter);
  }


  /**
     * Same as {@link Index#compareFiles} but files are already tokenized
     * Compare a list of files with each other and the files already stored in the
     * index. The compared files are also added to the index.
     *
     * @param tokenizedFiles: the tokenized file objects which need to be compared to the index
     * and each other. The file hashes will be added to the index.
     * @param hashFilter: an optional HashFilter. By default the HashFilter of the
     * Index object will be used.
     * @return an Report object, which is a list of Pairs
     * (containing all the pairedOccurrences between two files).
     */
  public async compareTokenizedFiles(
    tokenizedFiles: TokenizedFile[],
    hashFilter = this.hashFilter
  ): Promise<Report> {

    const report = new Report(this.options, tokenizedFiles);

    for (const file of tokenizedFiles) {
      let kgram = 0;
      for await (
        const { data, hash, start, stop  }
        of hashFilter.fingerprints(file.ast)
      ) {

        // add kgram to file
        file.kgrams.push(new Range(start, stop));

        // sanity check
        assert(
          Region.isInOrder(
            file.mapping[start],
            file.mapping[stop]
          )
            // If we end our kgram on a ')', the location of the opening token is used.
            // However, the location of this token in the file might be before
            // the location of the starting token of the kmer
            // For example: the last token of every ast is ')', closing the program.
            // The location of this token is always (0, 0), since the program root is the first token.
            // In this way, the 'end' token is before any other token in the AST.
            || file.ast[stop] === ")" ,
          `Invalid ordering:
             expected ${file.mapping[start]}
             to start be before the end of ${file.mapping[stop]}`
        );

        const location = Region.merge(
          file.mapping[start],
          file.mapping[stop]
        );

        const part: Occurrence = {
          file,
          side: { index: kgram, start, stop, data, location }
        };

        // look if the index already contains the given hashing
        const matches = this.index.get(hash);


        if (matches) {
          report.addOccurrences(hash, part, ...matches);

          // add our matching part to the index
          matches.push(part);
        } else {

          // if the hashing does not yet exist in the index, add it
          this.index.set(hash, [part]);
        }

        kgram += 1;
      }
    }
    report.finish();
    return report;

  }

  /**
   * Compare a file to the index. A map will be returned containing the filename
   * of the matching file, along with a list of matching position between the
   * two files.
   *
   * @param file The file to query
   * @param hashFilter An optional HashFilter. By default the HashFilter of the
   * Index object will be used.
   * @return report with the results of the comparison
   * contains the common hashes (occurrences) between two files.
   */
  public async compareFile(
    file: File,
    hashFilter = this.hashFilter
  ): Promise<Report> {
    return this.compareFiles([file], hashFilter);
  }
}
