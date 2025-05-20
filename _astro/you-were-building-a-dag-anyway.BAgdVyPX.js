const e="you-were-building-a-dag-anyway.mdx",n="blog",t="you-were-building-a-dag-anyway",a=`
import { Image } from 'astro:assets';
import example_dag_image from './images/20250509_152002.png';

<Image src={example_dag_image} alt="DAG of example workflow for experimental proteomics data" />

## Part 1: the soapbox

As a researcher/data scientist, I notice that each project has a similar lifecycle:

- You get some raw data
- You perform some processing on that raw data
- You do some analyses on that processed data
- You make some figures using those analyses
- You write a manuscript using those figures and analyses outcomes

> it seems so simple! why does this stuff need to take years? :)

In practice, these "processing" and "analyses" steps can involve many different subtasks,
and use a lot of different software/tooling, and also involve interdependencies.

But underneath it all, there is an "implicit graph" connecting these dependencies:
output of one (or more) step(s) is used as input to the next step, and ultimately this all ends up in "publication-grade" figures.

Since we're building that "directed, acyclic graph" (DAG) _anyway_, so why not formalize it, and reap the benefits?

### But, what are the benefits?
- proper description of the workflow
- provenance
  - the relationship between output files (e.g. figures, tables) and the inputs to them (either directly or transiently)
- cascading changes
  - as a consequence of the above: understanding which (output, or intermediate) files need to be recreated due to changes in input or parameters
- easily rerunning the workflow
- reusability

### But, is it worth the effort?
Well, maybe...

To be fair, I started doing this way too late.
I thought the cognitive load of remembering which file was generated using which script/notebook/shell command was tolerable.
I thought this was normal part of "my workload" and "my expertise".

However, as projects grow and drag on, remembering how you made \`peptide_database.hdf5\`, \`results.xlsx\` or \`input_table.tsv\` three years ago just becomes "not fun".

Sure, you can write a \`README.md\` or some notes you made in \`$internal_documentation_system\`, but that documentation might be out of date, missing some important details, etc.
And ultimately, all that serves as a description (albeit "informal") of that DAG you are building, *anyway*.

It would be great if it were something "executable" and reproducible, and guaranteed to be correct.

---

## Part 2: getting it done

### Tools of the trade

Unsurprisingly, the idea of describing a pipeline as a DAG is so common, that many different options exist.

Personally, I won't tell you to implement it one way or another, instead just describe the options I have considered and settled on.

One of the earliest posts (!) of [biostars](https://www.biostars.org/p/79/#81) is one that I can appreciate: just use the unix tool that already is out there: \`make\`!

\`make\` is software for "build automation", indeed mapping and ordering dependencies, 
commonly used for compilation of source code to executable programs.
During my PhD I did use \`make\` to setup pipelines.
However, I found ergonomics lacking (the syntax, tooling, introspection, documentation). 

In the years after, I've looked around for alternatives (and even built some, obviously and uncreatively called \`krmake\` ...)

- dvc
  - seems to focus on ML
- airflow / windmill
  - heavyweight
- snakemake
  - this is the one?

For now, I've settled on [snakemake](https://snakemake.github.io/).

There are some sharp edges: the syntax is "mostly-python",
and you can use python throughout the Snakemake file, 
but sometimes you get bitten by the preprocessing which happens behind the scenes 
(since it isn't really python, rather it gets "pre-processed").

The syntax is very much straightforward, mapping input(s) to output(s), using a script or command, which forms the "edge" in the graph:

\`\`\`python
SAMPLES = ["what", "ever"]  # load sample metadata e.g. with \`pandas\`

rule prepare_data:
    input:
        infiles=expand("data/raw/{sample}.tsv.gz", sample=SAMPLES),
        script="scripts/prepare_raw_data.py",
    output:
        samplesheet=protected("output/data/samplesheet.tsv"),
        measurements=protected("output/data/measurements.h5"),
    shell:
        """
        python {input.script} {input.infiles} -o {output.measurements} -m {output.samplesheet}
        """        

rule run_model:
    input:
        "output/data/samplesheet.tsv",
        "output/data/measurements.h5",
        script="notebooks/scripts/run_model.ipynb"
    output:
        protected("output/model-output/trace.h5"),
    shell:
        """
        jupyter execute --inplace {input.script}
        """

rule plot_coef_pairplot:
    input:
        "data/pipeline/samplesheet.tsv",
        "data/pipeline/intensity-values.tsv",
        "data/pipeline/model-output/pergene_hdis.h5",
        metadata="data/pipeline/raw/hgnc_metadata.tsv.gz",
        script="notebooks/manuscripts/biology-rbps-in-activation/scripts/plot_model_coeff_correlations.ipynb"
    output:
        "figures/pipeline/coef_pairplot.pdf"
    shell:
        """
        jupyter execute --inplace {input.script}
        """

rule plot_data_heatmaps:
    input:
        "data/pipeline/samplesheet.tsv",
        "data/pipeline/intensity-values.tsv",
        "data/pipeline/model-output/log_intensity_medians.tsv",
        "data/pipeline/model-output/pergene_hdis.h5",
        metadata="data/pipeline/raw/hgnc_metadata.tsv.gz",
        script="notebooks/manuscripts/biology-rbps-in-activation/scripts/plot_clustered_heatmap_zscores.ipynb"
    output:
        "figures/pipeline/zscaled-heatmap.pdf",
        "figures/pipeline/log-intensity-heatmap.pdf"
    shell:
        """
        jupyter execute --inplace {input.script}
        """

rule fig_heatmap:
    input:
        'figures/pipeline/zscaled-heatmap.pdf'

rule fig_coef_plot:
    input:
        'figures/pipeline/coef_pairplot.pdf'

# collect all figures in a meta "all" rule:
rule all:
    default_target: True
    input:
        rules.fig_heatmap.input,
        rules.fig_coef_plot.input,
\`\`\`


### What they didn't tell you

Describing the steps in your pipeline is only a part of what's necessary to create a truly reproducible pipeline.

Your processing steps will involve software, and thus there is a dependency between that software and the outcomes of your pipeline.
\`docker\` gives some reproducibility, as you can package software components into containers. 
However, some things are hard or impossible to capture and to make reproducible, such as:
- networking (using external resources that live on the internet, may change or disappear)
- your machine (a different CPU, different kernel, or even GPU drivers)

The non-reproducibility might take form of:
- runtime errors that didn't appear before
- rounding errors
- incomplete data, which can lead to silent errors (but wildly different results)

Here, I can only offer some advice, but there is no silver bullet.

When it comes to external data dependencies, just "vendor it in". This means, download what you need and treat it as a "raw data dependency" in your pipeline.
This makes that data a "leaf node" in your DAG. 

If it's just a matter of "download file from HTTP/FTP server", then you might get away with a rule in snakemake that calls curl.

I usually place such files in a "data/vendor/" subdirectory (as opposed to "data/raw/") and add some notes (in a README.md) next to it.
There, I describe which URL I obtained the data from (and sometimes, where on the website I had to click to obtain it).

With software dependencies, I make judgement calls. I try to use reproducible environments, e.g. python virtual environments (managed by poetry).
When properly described with lockfiles, this pins all external dependencies and their versions.
However, sometimes external software involves archaic build steps which are not really amenable to virtual environments. In such cases, I try to wrap them into a lightweight container.
And to admit, sometimes, I just omit that part of reproducibility...

---

## Part 3: tips and tricks for snakemake

### Show me your DAG

\`\`\`bash
snakemake --rulegraph | dot -Tpdf > snakemake_dag.pdf
\`\`\`

### Show me your plans
Useful when you have a larger pipeline. Get a table of jobs to run, their inputs and outputs, etc.

(install [visidata](https://www.visidata.org/) and thank me later)
\`\`\`bash
snakemake -D | vd
\`\`\`

### List the inputs

\`\`\`bash
snakemake -q -n -D -f | awk -F"\\t" '{print($5)}' | tail -n+2 | awk 'length($0) > 1' | tr , '\\n' | sort -V | uniq
\`\`\`

### Using jupyter notebooks

In a \`Snakemake\` file:
\`\`\`python
rule run_model:
    input:
        "output/data/samplesheet.tsv",
        "output/data/measurements.h5",
        script="notebooks/scripts/run_model.ipynb"
    output:
        protected("output/model-output/trace.h5"),
    shell:
        """
        jupyter execute --inplace {input.script}
        """
\`\`\`

This will execute the notebook and (re)write the results / figures, in the notebook file.

Note that it is not possible to pass arguments to the \`jupyter execute\` command; therefore it's hard to use notebooks as generic "data processing" scripts.
But for many academic purposes, that doesn't matter, as the notebooks are heavily tailored.
If you really want to pass dynamic arguments to the notebook, you might be able to do something with environment variables / \`.env\` files.

If you have a notebook which is generic and you want to run it on multiple input files, I recommend just refactoring the notebook into a proper python script.

### Using containers

Using rmarkdown / R in a docker container, in a Snakemake step:

\`\`\`Snakemake
rule r_limma:
    input:
        "datafile"
    output:
        "figures/plot.pdf"
    shell:
        # fun stuff, R in docker with R libraries in a docker volume ...
        """
        docker run \\
            --rm -it \\
            -v \`pwd\`/data/:/app/data/:ro \\
            -v \`pwd\`/scripts/pipeline/:/scripts/:ro \\
            -v \`pwd\`/data/pipeline/rstudio/:/output/ \\
            -v \`pwd\`/figures/pipeline/:/figures/ \\
            -v r_container_r_libs:/home/rstudio/lib \\
            -e R_LIBS=/home/rstudio/lib/:/usr/local/lib/R/site-library:/usr/local/lib/R/library \\
            --name 'rstudio_tmp_snakemake_limma' \\
            --entrypoint /bin/bash \\
            rocker/verse:4.3 \\
            -c "Rscript -e 'rmarkdown::render(\\\\"/scripts/run_limma.Rmd\\\\", output_dir=\\\\"/figures/\\\\", intermediates_dir=\\\\"/tmp/\\\\")'"
        """
\`\`\``,i={title:"You were building a DAG anyway",description:"Don't let your workflows live (and die) in your head",date:new Date(17467488e5),tags:["bioinformatics","data science","data engineering"],authors:["Koos Rooijers"]},o={type:"content",filePath:"/app/src/content/blog/you-were-building-a-dag-anyway.mdx",rawData:void 0};export{o as _internal,a as body,n as collection,i as data,e as id,t as slug};
