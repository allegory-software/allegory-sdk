
## Better alternatives to some standard library / glue functions

	os.getenv()          proc.env()
	os.rename()          fs.move()
	os.remove()          fs.remove()

	package.exepath      fs.exepath()
	package.exedir       fs.exedir()

	glue.bin()           fs.scriptdir()
	glue.canopen()       fs.is()
	glue.readfile()      fs.load()
	glue.writefile()     fs.save()
	glue.replacefile()   fs.move()
	glue.pcall()         errors.pcall()
	glue.readpipe()      proc.exec()
